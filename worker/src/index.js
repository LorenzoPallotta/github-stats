/**
 * Cloudflare Worker - login con GitHub e card SVG per i README.
 *
 * Rotte:
 *   POST   /                 scambio "code -> token" (il sito non puo' tenere il client secret);
 *                            con { keep: true } salva anche il refresh token per l'auto-update
 *   POST   /card             ricalcola e salva i numeri della card (serve il token dell'utente)
 *   DELETE /card             cancella la card dell'utente (e l'auto-update)
 *   DELETE /card/auto        spegne l'auto-update
 *   GET    /card/<login>.svg la card, da mettere nel README (?theme=dark per il tema scuro)
 *   GET    /card/<login>.json i numeri salvati, usati dal sito
 *
 * Cron (wrangler.toml, ogni ora): aggiorna le card con l'auto-update attivo,
 * al massimo una volta al giorno per utente (vedi runAutoUpdates).
 *
 * Il token dell'utente serve a sapere chi e' e a calcolare i numeri della card
 * (stats.js); non viene salvato. Nel KV finiscono:
 *   card:<login>  i numeri mostrati sulla card
 *   auth:<login>  solo con l'auto-update attivo: il refresh token, cifrato
 *                 con AES-GCM (crypto.js), il fuso orario e il prossimo aggiornamento
 *
 * Variabili richieste (Cloudflare -> Worker -> Settings -> Variables):
 *   GITHUB_CLIENT_ID      (secret)
 *   GITHUB_CLIENT_SECRET  (secret)
 *   TOKEN_KEY             (secret, 32 byte in base64: chiave per cifrare i refresh token)
 *   ALLOWED_ORIGIN        (variabile, es. https://tuonome.github.io)
 *   CARDS                 (KV namespace)
 */

import { buildCard } from "./stats.js";
import { seal, open } from "./crypto.js";

const LOGIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);

    // Lettura pubblica della card: nessun controllo sull'origine.
    const pub = url.pathname.match(/^\/card\/([^/]+)\.(svg|json)$/);
    if (pub && (request.method === "GET" || request.method === "HEAD")) {
      return serveCard(env, pub[1], pub[2], url.searchParams);
    }

    const cors = {
      "Access-Control-Allow-Origin": originOk ? origin : allowed[0] || "",
      "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    }
    if (!originOk) return json({ error: "forbidden" }, 403, cors);

    if (url.pathname === "/" && request.method === "POST") return exchangeCode(request, env, cors);
    if (url.pathname === "/card" && request.method === "POST") return saveCard(request, env, cors);
    if (url.pathname === "/card" && request.method === "DELETE") return deleteCard(request, env, cors);
    if (url.pathname === "/card/auto" && request.method === "DELETE") return disableAuto(request, env, cors);

    return json({ error: "not_found" }, 404, cors);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutoUpdates(env));
  },

};

/* ---------- Login ---------- */
async function exchangeCode(request, env, cors) {
  let code, keep, timeZone;
  try {
    ({ code, keep, timeZone } = await request.json());
  } catch {
    return json({ error: "bad_request" }, 400, cors);
  }
  if (typeof code !== "string" || code.length < 8 || code.length > 100) {
    return json({ error: "bad_request" }, 400, cors);
  }

  const gh = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "github-stats-auth-worker",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const data = await gh.json().catch(() => ({}));

  if (!data.access_token) {
    return json({ error: data.error || "exchange_failed", error_description: data.error_description || "" }, 400, cors);
  }

  // Aggiornamento automatico: solo se l'utente l'ha chiesto. Il refresh token resta qui, cifrato.
  let autoUpdate = false;
  if (keep === true && data.refresh_token) {
    // Se qualcosa va storto (es. TOKEN_KEY mancante) il login funziona lo stesso, senza auto-update
    try {
      const user = await whoAmIToken(data.access_token);
      if (user) {
        await env.CARDS.put(`auth:${user.login.toLowerCase()}`, JSON.stringify({
          ...(await seal(env, data.refresh_token)),
          timeZone: str(timeZone, 64) || "UTC",
          nextRun: Date.now() + 24 * 3600e3,
        }));
        autoUpdate = true;
      }
    } catch (e) {
      console.error("auto-update:", e.message);
    }
  }

  // Al browser serve solo il token e la sua durata.
  return json({ access_token: data.access_token, expires_in: data.expires_in || null, autoUpdate }, 200, cors);
}

/* ---------- Card: scrittura ---------- */

// Chiede a GitHub di chi e' il token. Cosi' ognuno puo' scrivere solo la propria card.
async function whoAmI(request) {
  const auth = request.headers.get("Authorization") || "";
  if (!/^Bearer [\w.-]{20,255}$/.test(auth)) return null;
  return whoAmIToken(auth.slice(7));
}

async function whoAmIToken(token) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "github-stats-auth-worker",
    },
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && typeof u.login === "string" && LOGIN_RE.test(u.login) ? u : null;
}


async function saveCard(request, env, cors) {
  const user = await whoAmI(request);
  if (!user) return json({ error: "unauthorized" }, 401, cors);

  let body = {};
  try { body = await request.json(); } catch {}
  const timeZone = str(body.timeZone, 64) || "UTC";

  // I numeri li calcola il worker: il browser manda solo il fuso orario
  const token = (request.headers.get("Authorization") || "").slice(7);
  let stats;
  try {
    stats = await buildCard(token, timeZone);
  } catch (e) {
    console.error("buildCard:", e.message);
    return json({ error: "stats_failed" }, 502, cors);
  }

  const card = makeCard(stats, user.login, timeZone);


  await env.CARDS.put(`card:${user.login.toLowerCase()}`, JSON.stringify(card));
  return json({ ok: true, login: user.login, updatedAt: card.updatedAt }, 200, cors);
}

function makeCard(stats, login, timeZone) {
  return {
    ...stats,
    login,
    name: str(stats.name, 60) || login,
    languages: stats.languages.map((l) => ({
      name: str(l.name, 30),
      pct: Math.min(100, Math.max(0, l.pct)),
      color: /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : null,
    })),
    timeZone,
    updatedAt: new Date().toISOString(),
  };
}


async function deleteCard(request, env, cors) {
  const user = await whoAmI(request);
  if (!user) return json({ error: "unauthorized" }, 401, cors);
  await env.CARDS.delete(`card:${user.login.toLowerCase()}`);
  await env.CARDS.delete(`auth:${user.login.toLowerCase()}`);
  return json({ ok: true }, 200, cors);
}

async function disableAuto(request, env, cors) {
  const user = await whoAmI(request);
  if (!user) return json({ error: "unauthorized" }, 401, cors);
  await env.CARDS.delete(`auth:${user.login.toLowerCase()}`);
  return json({ ok: true }, 200, cors);
}

function int(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.floor(n) : 0;
}
function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/* ---------- Card: lettura ---------- */
async function serveCard(env, login, ext, params) {
  const card = LOGIN_RE.test(login) ? await env.CARDS.get(`card:${login.toLowerCase()}`, "json") : null;

  if (ext === "json") {
    const autoUpdate = card ? (await env.CARDS.get(`auth:${login.toLowerCase()}`)) !== null : false;
    return json(card ? { ...card, autoUpdate } : { error: "not_found" }, card ? 200 : 404, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
  }

  const opts = cardOptions(params);
  const svg = card ? renderCard(card, opts) : renderMissing(login, opts.theme);
  return new Response(svg, {
    status: 200, // anche se manca: GitHub mostra l'immagine invece di un'icona rotta
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": card ? "public, max-age=1800" : "public, max-age=300",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const THEMES = {
  light: { bg: "#ffffff", border: "#d0d7de", text: "#1f2328", muted: "#59636e", accent: "#0969da", track: "#eaeef2" },
  dark: { bg: "#0d1117", border: "#30363d", text: "#e6edf3", muted: "#9198a1", accent: "#4493f8", track: "#21262d" },
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function fmt(n) {
  return new Intl.NumberFormat("en-US").format(n);
}
function svgStyle(t) {
  return `<style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: ${t.text}; }
    .title { font-size: 17px; font-weight: 600; fill: ${t.accent}; }
    .label { font-size: 13px; fill: ${t.muted}; }
    .value { font-size: 13px; font-weight: 600; }
    .head { font-size: 13px; font-weight: 600; }
    .lang { font-size: 12px; }
    .foot { font-size: 10px; fill: ${t.muted}; }
  </style>`;
}

/* Opzioni della card, lette dall'URL. Valori sconosciuti -> default. */
const LANG_STYLES = ["bar", "donut", "pie", "hide"];
const STAT_KEYS = ["contributions", "private", "streak", "longest", "commits", "prs", "stars", "repos"];

function cardOptions(params) {
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  const langs = LANG_STYLES.includes(params.get("langs")) ? params.get("langs") : "bar";
  const hide = new Set((params.get("hide") || "").split(",").map((s) => s.trim()).filter((s) => STAT_KEYS.includes(s)));
  return { theme, langs, hide };
}

function renderCard(c, opts) {
  const t = THEMES[opts.theme] || THEMES.light;
  const days = (n) => `${fmt(n)} ${n === 1 ? "day" : "days"}`;

  const rows = [
    ["contributions", "Total contributions", fmt(c.totalContributions)],
    ["private", "Private contributions", fmt(c.privateContributions)],
    ["streak", "Current streak", days(c.currentStreak)],
    ["longest", "Longest streak", days(c.longestStreak)],
    ["commits", "Commits", fmt(c.commits)],
    ["prs", "Pull requests", fmt(c.pullRequests)],
    ["stars", "Stars earned", fmt(c.stars)],
  ].filter(([key]) => !opts.hide.has(key));

  const showLangs = opts.langs !== "hide";
  const W = showLangs ? 500 : 280;
  const stats = rows.map(([, label, value], i) => {
    const y = 72 + i * 21;
    return `<text x="25" y="${y}" class="label">${esc(label)}</text>`
      + `<text x="${showLangs ? 245 : W - 25}" y="${y}" class="value" text-anchor="end">${esc(value)}</text>`;
  }).join("");
  const statsBottom = 72 + Math.max(rows.length - 1, 0) * 21;

  const langs = showLangs ? renderLangs(c.languages.slice(0, 5), opts.langs, t) : { svg: "", bottom: 0 };

  // Altezza: la colonna più lunga + il piè di pagina
  const H = Math.max(statsBottom, langs.bottom, 100) + 42;

  const updated = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(c.updatedAt));
  // Card stretta (senza lingue): testi più corti
  const repos = opts.hide.has("repos") ? ""
    : showLangs ? `${fmt(c.repos)} repositories (${fmt(c.privateRepos)} private)` : `${fmt(c.repos)} repos`;
  const maxName = showLangs ? 28 : 22;
  const name = c.name.length > maxName ? `${c.name.slice(0, maxName - 1)}…` : c.name;
  const title = showLangs ? `${name}'s GitHub stats` : name;
  const foot = `<text x="25" y="${H - 16}" class="foot">${esc(repos)}</text>`
    + `<text x="${W - 25}" y="${H - 16}" class="foot" text-anchor="end">Updated ${esc(updated)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t">
  <title id="t">${esc(c.name)}'s GitHub stats: ${fmt(c.totalContributions)} contributions, ${fmt(c.privateContributions)} private</title>
  ${svgStyle(t)}
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>
  <text x="25" y="36" class="title">${esc(title)}</text>
  ${stats}
  ${langs.svg}
  ${foot}
</svg>`;
}

// Colonna destra delle lingue: barra, ciambella o torta. Restituisce lo SVG e dove finisce in basso.
function renderLangs(langs, style, t) {
  const x0 = 275, x1 = 475;
  const head = `<text x="${x0}" y="52" class="head">Top languages</text>`;
  if (!langs.length) return { svg: `${head}<text x="${x0}" y="78" class="label">No data</text>`, bottom: 78 };

  const total = langs.reduce((a, l) => a + l.pct, 0) || 1;
  const pct = (l) => (l.pct < 1 ? l.pct.toFixed(1) : Math.round(l.pct));
  const color = (l) => l.color || t.muted;

  if (style === "bar") {
    let x = x0;
    const w = x1 - x0;
    const segs = langs.map((l) => {
      const sw = (l.pct / total) * w;
      const r = `<rect x="${x.toFixed(1)}" y="64" width="${sw.toFixed(1)}" height="8" fill="${color(l)}"/>`;
      x += sw;
      return r;
    }).join("");
    const list = langs.map((l, i) => {
      const y = 96 + i * 21;
      return `<circle cx="${x0 + 5}" cy="${y - 4}" r="5" fill="${color(l)}"/>`
        + `<text x="${x0 + 16}" y="${y}" class="lang">${esc(l.name)}</text>`
        + `<text x="${x1}" y="${y}" class="lang" text-anchor="end">${pct(l)}%</text>`;
    }).join("");
    return {
      svg: `${head}<clipPath id="bar"><rect x="${x0}" y="64" width="${w}" height="8" rx="4"/></clipPath>`
        + `<rect x="${x0}" y="64" width="${w}" height="8" rx="4" fill="${t.track}"/>`
        + `<g clip-path="url(#bar)">${segs}</g>${list}`,
      bottom: 96 + (langs.length - 1) * 21,
    };
  }

  // Ciambella / torta: cerchi con stroke-dasharray su pathLength=100.
  // La torta è una ciambella con il tratto largo quanto il raggio, così riempie il centro.
  const cx = x0 + 40, cy = 108;
  const [r, sw] = style === "pie" ? [20, 40] : [32, 14];
  let acc = 0;
  const segs = langs.map((l) => {
    const p = (l.pct / total) * 100;
    const s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color(l)}" stroke-width="${sw}" pathLength="100"`
      + ` stroke-dasharray="${p.toFixed(2)} ${(100 - p).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}"`
      + ` transform="rotate(-90 ${cx} ${cy})"/>`;
    acc += p;
    return s;
  }).join("");
  const lx = x0 + 92;
  const list = langs.map((l, i) => {
    const y = 74 + i * 19;
    const n = l.name.length > 11 ? `${l.name.slice(0, 10)}…` : l.name;
    return `<circle cx="${lx + 4}" cy="${y - 4}" r="4" fill="${color(l)}"/>`
      + `<text x="${lx + 13}" y="${y}" class="lang">${esc(n)}</text>`
      + `<text x="${x1}" y="${y}" class="lang" text-anchor="end">${pct(l)}%</text>`;
  }).join("");
  return {
    svg: `${head}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${t.track}" stroke-width="${sw}"/>${segs}${list}`,
    bottom: Math.max(cy + 40, 74 + (langs.length - 1) * 19),
  };
}

function renderMissing(login, theme) {
  const t = THEMES[theme] || THEMES.light;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="80" viewBox="0 0 500 80" role="img" aria-label="No card">
  ${svgStyle(t)}
  <rect x="0.5" y="0.5" width="499" height="79" rx="10" fill="${t.bg}" stroke="${t.border}"/>
  <text x="25" y="35" class="head">No GitHub Stats card for @${esc(login.slice(0, 39))}</text>
  <text x="25" y="56" class="label">Sign in on the GitHub Stats site and click “Publish card”.</text>
</svg>`;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/* ---------- Aggiornamento automatico (cron) ---------- */
const AUTO_BATCH = 3;          // utenti per esecuzione (limite di 50 sotto-richieste)
const DAY = 24 * 3600e3;

async function runAutoUpdates(env) {
  const now = Date.now();
  const { keys } = await env.CARDS.list({ prefix: "auth:" });
  const due = [];
  for (const { name } of keys) {
    const entry = await env.CARDS.get(name, "json");
    if (entry && entry.nextRun <= now) due.push({ name, entry });
  }
  due.sort((a, b) => a.entry.nextRun - b.entry.nextRun);

  for (const { name, entry } of due.slice(0, AUTO_BATCH)) {
    try {
      await autoUpdate(env, name, entry);
    } catch (e) {
      console.error(`auto-update ${name}:`, e.message);
      // riprova tra un'ora (entry contiene già l'ultimo refresh token valido)
      entry.nextRun = Date.now() + 3600e3;
      await env.CARDS.put(name, JSON.stringify(entry));
    }
  }
}

async function autoUpdate(env, key, entry) {
  const login = key.slice("auth:".length);

  // Se la card è stata rimossa, non c'è niente da aggiornare: via anche il token
  const existing = await env.CARDS.get(`card:${login}`, "json");
  if (!existing) { await env.CARDS.delete(key); return; }

  // 1. Nuovo access token dal refresh token
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "github-stats-auth-worker" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: await open(env, entry),
    }),
  });
  const t = await res.json().catch(() => ({}));

  if (!t.access_token || !t.refresh_token) {
    // Token revocato o scaduto: l'utente deve riattivare l'auto-update
    if (t.error === "bad_refresh_token") { await env.CARDS.delete(key); console.log(`auto-update ${login}: token revoked, disabled`); return; }
    throw new Error(t.error || `refresh HTTP ${res.status}`);
  }

  // 2. Salva SUBITO il nuovo refresh token: quello vecchio non vale più
  //    (aggiorna anche entry: se dopo qualcosa fallisce, il catch salva il token nuovo)
  Object.assign(entry, await seal(env, t.refresh_token), { nextRun: Date.now() + DAY });
  await env.CARDS.put(key, JSON.stringify(entry));

  // 3. Ricalcola e salva la card
  const stats = await buildCard(t.access_token, entry.timeZone);
  if (stats.login.toLowerCase() !== login) throw new Error("login mismatch");
  await env.CARDS.put(`card:${login}`, JSON.stringify(makeCard(stats, stats.login, entry.timeZone)));
  console.log(`auto-update ${login}: ok`);
}
