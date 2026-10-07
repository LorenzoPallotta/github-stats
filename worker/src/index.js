/**
 * Cloudflare Worker - login con GitHub e card SVG per i README.
 *
 * Rotte:
 *   POST   /                 scambio "code -> token" (il sito non puo' tenere il client secret)
 *   POST   /card             salva lo snapshot dei numeri della card (serve il token dell'utente)
 *   DELETE /card             cancella la card dell'utente
 *   GET    /card/<login>.svg la card, da mettere nel README (?theme=dark per il tema scuro)
 *   GET    /card/<login>.json i numeri salvati, usati dal sito
 *
 * Il token dell'utente serve solo a chiedere a GitHub chi e' (GET /user) e non
 * viene salvato. Nel KV finiscono solo i numeri mostrati sulla card.
 *
 * Variabili richieste (Cloudflare -> Worker -> Settings -> Variables):
 *   GITHUB_CLIENT_ID      (secret)
 *   GITHUB_CLIENT_SECRET  (secret)
 *   ALLOWED_ORIGIN        (variabile, es. https://tuonome.github.io)
 *   CARDS                 (KV namespace)
 */

import { buildCard } from "./stats.js";
import { seal } from "./crypto.js";

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
      return serveCard(env, pub[1], pub[2], url.searchParams.get("theme"));
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

  const card = {
    ...stats,
    login: user.login,
    name: str(stats.name, 60) || user.login,
    languages: stats.languages.map((l) => ({
      name: str(l.name, 30),
      pct: Math.min(100, Math.max(0, l.pct)),
      color: /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : null,
    })),
    timeZone,
    updatedAt: new Date().toISOString(),
  };

  await env.CARDS.put(`card:${user.login.toLowerCase()}`, JSON.stringify(card));
  return json({ ok: true, login: user.login, updatedAt: card.updatedAt }, 200, cors);
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
async function serveCard(env, login, ext, theme) {
  const card = LOGIN_RE.test(login) ? await env.CARDS.get(`card:${login.toLowerCase()}`, "json") : null;

  if (ext === "json") {
    const autoUpdate = card ? (await env.CARDS.get(`auth:${login.toLowerCase()}`)) !== null : false;
    return json(card ? { ...card, autoUpdate } : { error: "not_found" }, card ? 200 : 404, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
  }

  const svg = card ? renderCard(card, theme) : renderMissing(login, theme);
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

function renderCard(c, theme) {
  const t = THEMES[theme] || THEMES.light;
  const W = 500, H = 245;

  const rows = [
    ["Total contributions", fmt(c.totalContributions)],
    ["Private contributions", fmt(c.privateContributions)],
    ["Current streak", `${fmt(c.currentStreak)} ${c.currentStreak === 1 ? "day" : "days"}`],
    ["Longest streak", `${fmt(c.longestStreak)} ${c.longestStreak === 1 ? "day" : "days"}`],
    ["Commits", fmt(c.commits)],
    ["Pull requests", fmt(c.pullRequests)],
    ["Stars earned", fmt(c.stars)],
  ];
  const stats = rows.map(([label, value], i) => {
    const y = 72 + i * 21;
    return `<text x="25" y="${y}" class="label">${esc(label)}</text>`
      + `<text x="245" y="${y}" class="value" text-anchor="end">${esc(value)}</text>`;
  }).join("");

  // Lingue: barra unica divisa per percentuale + elenco
  const langs = c.languages.slice(0, 5);
  const total = langs.reduce((a, l) => a + l.pct, 0) || 1;
  const barX = 275, barW = 200;
  let x = barX;
  const bar = langs.map((l) => {
    const w = (l.pct / total) * barW;
    const r = `<rect x="${x.toFixed(1)}" y="64" width="${w.toFixed(1)}" height="8" fill="${l.color || t.muted}"/>`;
    x += w;
    return r;
  }).join("");
  const list = langs.map((l, i) => {
    const y = 96 + i * 21;
    return `<circle cx="${barX + 5}" cy="${y - 4}" r="5" fill="${l.color || t.muted}"/>`
      + `<text x="${barX + 16}" y="${y}" class="lang">${esc(l.name)}</text>`
      + `<text x="${barX + barW}" y="${y}" class="lang" text-anchor="end">${l.pct < 1 ? l.pct.toFixed(1) : Math.round(l.pct)}%</text>`;
  }).join("");

  const updated = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(c.updatedAt));
  const repos = `${fmt(c.repos)} repositories (${fmt(c.privateRepos)} private)`;
  const name = c.name.length > 28 ? `${c.name.slice(0, 27)}…` : c.name;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t">
  <title id="t">${esc(c.name)}'s GitHub stats: ${fmt(c.totalContributions)} contributions, ${fmt(c.privateContributions)} private</title>
  ${svgStyle(t)}
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>
  <text x="25" y="36" class="title">${esc(name)}'s GitHub stats</text>
  ${stats}
  <text x="${barX}" y="52" class="head">Top languages</text>
  <clipPath id="bar"><rect x="${barX}" y="64" width="${barW}" height="8" rx="4"/></clipPath>
  <rect x="${barX}" y="64" width="${barW}" height="8" rx="4" fill="${t.track}"/>
  <g clip-path="url(#bar)">${bar}</g>
  ${list || `<text x="${barX}" y="96" class="label">No data</text>`}
  <text x="25" y="${H - 16}" class="foot">${esc(repos)}</text>
  <text x="${W - 25}" y="${H - 16}" class="foot" text-anchor="end">Updated ${esc(updated)}</text>
</svg>`;
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
