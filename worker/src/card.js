/**
 * Disegno della card SVG: opzioni dall'URL, temi, statistiche, lingue, voto, mini calendario.
 * Funzioni pure (niente rete, niente KV): facili da testare.
 */

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
    .grade { font-size: 14px; font-weight: 700; fill: ${t.text}; }
  </style>`;
}

/* Opzioni della card, lette dall'URL. Valori sconosciuti -> default. */
export const LANG_STYLES = ["bar", "donut", "pie", "hide"];
export const STAT_KEYS = ["contributions", "private", "streak", "longest", "commits", "prs", "stars", "repos"];

export function cardOptions(params) {
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  const langs = LANG_STYLES.includes(params.get("langs")) ? params.get("langs") : "bar";
  const hide = new Set((params.get("hide") || "").split(",").map((s) => s.trim()).filter((s) => STAT_KEYS.includes(s)));
  const on = (k) => ["true", "1", "yes"].includes((params.get(k) || "").toLowerCase());
  return { theme, langs, hide, grade: on("grade"), calendar: on("calendar") };
}

export function renderCard(c, opts) {
  const t = THEMES[opts.theme] || THEMES.light;
  const days = (n) => `${fmt(n)} ${n === 1 ? "day" : "days"}`;

  const rows = [
    ["contributions", "Total contributions", fmt(c.totalContributions)],
    ["private", "Private contributions", fmt(c.privateContributions)],
    ["streak", "Current streak", days(c.currentStreak)],
    ["longest", "Longest streak", days(c.longestStreak)],
    ["commits", "Commits", fmt(c.commits)],
    // null = GitHub non ha dato il numero (permesso mancante): la riga non compare
    ["prs", "Pull requests", c.pullRequests == null ? null : fmt(c.pullRequests)],
    ["stars", "Stars earned", fmt(c.stars)],
  ].filter(([key, , value]) => !opts.hide.has(key) && value !== null);

  const showLangs = opts.langs !== "hide";
  const W = showLangs ? 500 : 280;
  const stats = rows.map(([, label, value], i) => {
    const y = 72 + i * 21;
    return `<text x="25" y="${y}" class="label">${esc(label)}</text>`
      + `<text x="${showLangs ? 245 : W - 25}" y="${y}" class="value" text-anchor="end">${esc(value)}</text>`;
  }).join("");
  const statsBottom = 72 + Math.max(rows.length - 1, 0) * 21;

  const langs = showLangs ? renderLangs(c.languages.slice(0, 5), opts.langs, t) : { svg: "", bottom: 0 };

  // Sotto le colonne: il mini calendario (solo se la card ha i dati giorno per giorno)
  const contentBottom = Math.max(statsBottom, langs.bottom, 100);
  const cal = opts.calendar ? renderCalendar(c, W, contentBottom, t) : { svg: "", bottom: contentBottom };

  // Altezza: fino al contenuto più in basso + il piè di pagina
  const H = cal.bottom + 42;

  const updated = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(c.updatedAt));
  // Card stretta (senza lingue): testi più corti
  const repos = opts.hide.has("repos") ? ""
    : showLangs ? `${fmt(c.repos)} repositories (${fmt(c.privateRepos)} private)` : `${fmt(c.repos)} repos`;
  const maxName = showLangs ? 28 : opts.grade ? 14 : 22;
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
  ${opts.grade ? renderGrade(c, W, t) : ""}
  ${cal.svg}
  ${foot}
</svg>`;
}

/* Voto: media pesata di alcuni numeri, ognuno schiacciato tra 0 e 1 con 1 - e^(-x/m).
   m è il valore "tipico": chi ce l'ha prende circa 0,63 su quella voce.
   I pesi e i valori tipici sono una scelta, non una verità: cambiali qui. */
const GRADE_PARTS = [
  { key: "totalContributions", m: 500, w: 3 },
  { key: "longestStreak", m: 14, w: 2 },
  { key: "stars", m: 20, w: 1 },
  { key: "pullRequests", m: 20, w: 1 },
];
const GRADE_STEPS = [[0.85, "S"], [0.75, "A+"], [0.62, "A"], [0.5, "B+"], [0.37, "B"], [0.25, "C+"], [0, "C"]];

export function gradeOf(c) {
  const wsum = GRADE_PARTS.reduce((a, p) => a + p.w, 0);
  const score = GRADE_PARTS.reduce((a, p) => a + p.w * (1 - Math.exp(-(Number(c[p.key]) || 0) / p.m)), 0) / wsum;
  return { score, letter: GRADE_STEPS.find(([min]) => score >= min)[1] };
}

// Anello in alto a destra: si riempie in base al punteggio, con la lettera al centro
function renderGrade(c, W, t) {
  const { score, letter } = gradeOf(c);
  const cx = W - 44, cy = 36, r = 17;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${t.track}" stroke-width="4"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${t.accent}" stroke-width="4" stroke-linecap="round" pathLength="100"`
    + ` stroke-dasharray="${(score * 100).toFixed(1)} 100" transform="rotate(-90 ${cx} ${cy})"/>`
    + `<text x="${cx}" y="${cy + 5}" class="grade" text-anchor="middle">${letter}</text>`;
}

// Mini calendario: le ultime settimane che stanno nella larghezza, colonne = settimane, righe = giorni (dom-sab)
function renderCalendar(c, W, top, t) {
  const recent = Array.isArray(c.recent) ? c.recent : [];
  if (!recent.length || !c.recentEnd) return { svg: "", bottom: top }; // card vecchia: serve un "Update card"

  const cell = 8, step = 10;
  const weeks = Math.floor((W - 50 + (step - cell)) / step);
  const lastWd = new Date(`${c.recentEnd}T00:00:00Z`).getUTCDay();
  const n = Math.min(recent.length, (weeks - 1) * 7 + lastWd + 1);
  const days = recent.slice(-n);
  const max = Math.max(...days, 1);

  const headY = top + 30, gridY = headY + 10;
  // Il primo giorno mostrato cade nella riga del suo giorno della settimana
  const firstWd = (lastWd - (n - 1) % 7 + 7) % 7;
  const cells = days.map((v, i) => {
    const pos = firstWd + i;
    const x = 25 + Math.floor(pos / 7) * step, y = gridY + (pos % 7) * step;
    const level = v === 0 ? 0 : Math.ceil((v / max) * 4);
    const fill = level === 0 ? `fill="${t.track}"` : `fill="${t.accent}" fill-opacity="${[0, 0.3, 0.55, 0.8, 1][level]}"`;
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" ${fill}/>`;
  }).join("");

  const total = days.reduce((a, v) => a + v, 0);
  return {
    svg: `<text x="25" y="${headY}" class="head">Last ${Math.ceil((firstWd + n) / 7)} weeks</text>`
      + `<text x="${W - 25}" y="${headY}" class="label" text-anchor="end">${fmt(total)} contributions</text>${cells}`,
    bottom: gridY + 7 * step - (step - cell),
  };
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

export function renderMissing(login, theme) {
  const t = THEMES[theme] || THEMES.light;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="80" viewBox="0 0 500 80" role="img" aria-label="No card">
  ${svgStyle(t)}
  <rect x="0.5" y="0.5" width="499" height="79" rx="10" fill="${t.bg}" stroke="${t.border}"/>
  <text x="25" y="35" class="head">No GitHub Stats card for @${esc(login.slice(0, 39))}</text>
  <text x="25" y="56" class="label">Sign in on the GitHub Stats site and click “Publish card”.</text>
</svg>`;
}
