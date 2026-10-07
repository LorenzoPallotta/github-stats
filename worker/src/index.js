/**
 * Cloudflare Worker - login con GitHub e card SVG per i README.
 *
 * Rotte:
 *   POST   /                 scambio "code -> token" (il sito non puo' tenere il client secret);
 *                            con { keep: true } salva anche il refresh token per l'auto-update
 *   POST   /card             ricalcola e salva i numeri della card (serve il token dell'utente; max 1 al minuto)
 *   DELETE /card             cancella la card dell'utente (e l'auto-update)
 *   DELETE /card/auto        spegne l'auto-update
 *   GET    /card/<login>.svg la card, da mettere nel README (?theme=dark per il tema scuro)
 *   GET    /card/<login>.json i numeri salvati, usati dal sito
 *
 * Cron (wrangler.toml, ogni 10 minuti): aggiorna le card con l'auto-update attivo,
 * al massimo una volta al giorno per utente (vedi runAutoUpdates).
 *
 * Il token dell'utente serve a sapere chi e' e a calcolare i numeri della card
 * (stats.js); non viene salvato. Nel KV finiscono:
 *   card:<login>  i numeri mostrati sulla card
 *   rl:card:<login> limite di frequenza su POST /card (scade da solo dopo 60 s)
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
import { cardOptions, renderCard, renderMissing } from "./card.js";

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
        await putAuth(env, `auth:${user.login.toLowerCase()}`, {
          ...(await seal(env, data.refresh_token)),
          timeZone: str(timeZone, 64) || "UTC",
          nextRun: Date.now() + DAY,
        });
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

  // Limite: un ricalcolo al minuto per utente (ogni ricalcolo fa molte chiamate a GitHub).
  // Il controllo sull'Origin non basta: da curl si falsifica. KV è "quasi" consistente,
  // quindi il limite è approssimativo, ma basta a fermare le raffiche.
  const rlKey = `rl:card:${user.login.toLowerCase()}`;
  if (await env.CARDS.get(rlKey)) return json({ error: "too_many_requests" }, 429, { ...cors, "Retry-After": "60" });
  await env.CARDS.put(rlKey, "1", { expirationTtl: 60 });

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
    recent: (Array.isArray(stats.recent) ? stats.recent : []).slice(-371).map(int),
    recentEnd: /^\d{4}-\d{2}-\d{2}$/.test(stats.recentEnd) ? stats.recentEnd : null,
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

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/* ---------- Aggiornamento automatico (cron) ---------- */
// Il cron gira ogni 10 minuti (wrangler.toml): 3 utenti x 144 esecuzioni = fino a 432 aggiornamenti al giorno.
const AUTO_BATCH = 3;          // utenti per esecuzione (limite di 50 sotto-richieste)
const DAY = 24 * 3600e3;

// Salva auth:<login> mettendo nextRun anche nei metadata: list() li restituisce
// senza dover leggere ogni chiave.
async function putAuth(env, key, entry) {
  await env.CARDS.put(key, JSON.stringify(entry), { metadata: { nextRun: entry.nextRun } });
}

async function runAutoUpdates(env) {
  const now = Date.now();

  // Chi è da aggiornare? Basta list() con i metadata, pagina per pagina (max 1000 chiavi a pagina).
  const due = [];
  let cursor;
  do {
    const page = await env.CARDS.list({ prefix: "auth:", cursor });
    for (const { name, metadata } of page.keys) {
      const nextRun = metadata?.nextRun ?? 0; // chiavi vecchie senza metadata: da aggiornare subito
      if (nextRun <= now) due.push({ name, nextRun });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  due.sort((a, b) => a.nextRun - b.nextRun);

  // Solo per i primi AUTO_BATCH si legge il contenuto (token cifrato)
  for (const { name } of due.slice(0, AUTO_BATCH)) {
    const entry = await env.CARDS.get(name, "json");
    if (!entry) continue;
    try {
      await autoUpdate(env, name, entry);
    } catch (e) {
      console.error(`auto-update ${name}:`, e.message);
      // riprova tra un'ora (entry contiene già l'ultimo refresh token valido)
      entry.nextRun = Date.now() + 3600e3;
      await putAuth(env, name, entry);
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
  await putAuth(env, key, entry);

  // 3. Ricalcola e salva la card
  const stats = await buildCard(t.access_token, entry.timeZone);
  if (stats.login.toLowerCase() !== login) throw new Error("login mismatch");
  await env.CARDS.put(`card:${login}`, JSON.stringify(makeCard(stats, stats.login, entry.timeZone)));
  console.log(`auto-update ${login}: ok`);
}
