/**
 * Cloudflare Worker - scambio "code -> token" per il login con GitHub.
 *
 * Il sito su GitHub Pages non puo' conservare il client secret, quindi
 * questo Worker fa l'unico passaggio che lo richiede e restituisce al
 * browser solo il token dell'utente. Non salva nulla.
 *
 * Variabili richieste (Cloudflare -> Worker -> Settings -> Variables):
 *   GITHUB_CLIENT_ID      (secret)
 *   GITHUB_CLIENT_SECRET  (secret)
 *   ALLOWED_ORIGIN        (variabile, es. https://tuonome.github.io)
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);

    const cors = {
      "Access-Control-Allow-Origin": originOk ? origin : allowed[0] || "",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    }

    if (request.method !== "POST" || !originOk) {
      return json({ error: "forbidden" }, 403, cors);
    }

    let code;
    try {
      ({ code } = await request.json());
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

    // Al browser serve solo il token e la sua durata.
    return json({ access_token: data.access_token, expires_in: data.expires_in || null }, 200, cors);
  },
};

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
