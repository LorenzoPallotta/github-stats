"use strict";

/* =========================================================
   GitHub Stats - sito statico per GitHub Pages
   Login con GitHub App (scambio del codice tramite Worker),
   poi tutte le chiamate alle API partono dal browser.
   ========================================================= */

const CFG = window.APP_CONFIG || {};
const API = "https://api.github.com";
const TOKEN_KEY = "ghs_token";
const STATE_KEY = "ghs_oauth_state";
const MAX_REPO_PAGES = 10;      // fino a 1000 repository
const MAX_TRAFFIC_REPOS = 25;   // traffico: i repo con push più recente

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("it-IT");
const df = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });
const dfShort = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" });
const WEEKDAYS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
const WEEKDAYS_SHORT = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

/* ---------- Utilità DOM (niente innerHTML con dati esterni) ---------- */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
function show(id) {
  for (const v of ["viewLogin", "viewLoading", "viewError", "viewDashboard"]) $(v).hidden = v !== id;
}
function setLoading(text) { $("loadingText").textContent = text; show("viewLoading"); }
function showError(msg) {
  $("viewError").replaceChildren(el("strong", { text: "Errore: " }), msg);
  show("viewError");
}
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseISODate(s) { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); }

/* ---------- Tema ---------- */
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("ghs_theme"); } catch {}
  if (saved) document.documentElement.dataset.theme = saved;
  $("btnTheme").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("ghs_theme", next); } catch {}
  });
})();

/* ---------- Tooltip condiviso ---------- */
(function initTooltip() {
  const tip = $("tooltip");
  function place(x, y) {
    const r = tip.getBoundingClientRect();
    let left = x + 12, top = y + 12;
    if (left + r.width > innerWidth - 8) left = x - r.width - 12;
    if (top + r.height > innerHeight - 8) top = y - r.height - 12;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) return;
    tip.textContent = t.dataset.tip; tip.hidden = false; place(e.clientX, e.clientY);
  });
  document.addEventListener("pointermove", (e) => { if (!tip.hidden) place(e.clientX, e.clientY); });
  document.addEventListener("pointerout", (e) => {
    if (e.target.closest("[data-tip]") && !e.relatedTarget?.closest?.("[data-tip]")) tip.hidden = true;
  });
  document.addEventListener("focusin", (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (!t) { tip.hidden = true; return; }
    const r = t.getBoundingClientRect();
    tip.textContent = t.dataset.tip; tip.hidden = false; place(r.right, r.bottom);
  });
})();

/* =========================================================
   Autenticazione
   ========================================================= */
function configOk() {
  return CFG.CLIENT_ID && !CFG.CLIENT_ID.startsWith("INSERISCI")
    && CFG.WORKER_URL && !CFG.WORKER_URL.includes("TUONOME");
}
function redirectUri() { return location.origin + location.pathname; }
function getToken() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } }

function login() {
  const state = crypto.getRandomValues(new Uint32Array(4)).join("-");
  sessionStorage.setItem(STATE_KEY, state);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", CFG.CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  location.assign(url.toString());
}

function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  location.replace(redirectUri());
}

async function handleCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return false;

  const state = params.get("state");
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  history.replaceState(null, "", redirectUri()); // toglie ?code dall'indirizzo

  // Se l'accesso arriva dall'installazione dell'app non c'è "state": va bene lo stesso.
  if (state && state !== expected) throw new Error("Verifica di sicurezza non superata (state). Riprova l'accesso.");

  setLoading("Completo l'accesso…");
  const res = await fetch(CFG.WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Accesso non riuscito (${data.error_description || data.error || res.status}).`);
  }
  sessionStorage.setItem(TOKEN_KEY, data.access_token);
  return true;
}

/* =========================================================
   Chiamate API
   ========================================================= */
async function gql(query, variables = {}) {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) { sessionStorage.removeItem(TOKEN_KEY); throw new Error("Sessione scaduta: accedi di nuovo."); }
  const j = await res.json();
  if (j.errors && !j.data) throw new Error(j.errors.map((e) => e.message).join("; "));
  return j.data;
}

async function rest(path) {
  const res = await fetch(API + path, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

const Q_PROFILE = `
query {
  viewer {
    login name avatarUrl url createdAt bio company location
    followers { totalCount }
    following { totalCount }
    gists(privacy: ALL) { totalCount }
    starredRepositories { totalCount }
    issues { totalCount }
    pullRequests { totalCount }
    mergedPRs: pullRequests(states: MERGED) { totalCount }
    contributionsCollection { contributionYears }
  }
}`;

function yearsQuery(years) {
  const now = new Date();
  const parts = years.map((y) => {
    const to = y === now.getFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`;
    return `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${to}") {
      totalCommitContributions totalPullRequestContributions totalPullRequestReviewContributions
      totalIssueContributions totalRepositoryContributions restrictedContributionsCount
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }`;
  });
  return `query { viewer { ${parts.join("\n")} } }`;
}

const Q_REPOS = `
query($cursor: String) {
  viewer {
    repositories(first: 100, after: $cursor,
                 ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
                 orderBy: { field: PUSHED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name nameWithOwner url description isPrivate isFork isArchived
        stargazerCount forkCount pushedAt createdAt viewerPermission
        owner { login }
        primaryLanguage { name }
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } }
      }
    }
  }
}`;

async function fetchAll() {
  setLoading("Leggo il profilo…");
  const profile = (await gql(Q_PROFILE)).viewer;

  // Contributi di tutti gli anni (a gruppi di 3 per non appesantire la query)
  const years = [...profile.contributionsCollection.contributionYears].sort((a, b) => a - b);
  const yearly = {};
  for (let i = 0; i < years.length; i += 3) {
    const chunk = years.slice(i, i + 3);
    setLoading(`Leggo i contributi ${chunk[0]}–${chunk[chunk.length - 1]}…`);
    const data = (await gql(yearsQuery(chunk))).viewer;
    for (const y of chunk) yearly[y] = data[`y${y}`];
  }

  // Repository (paginati)
  const repos = [];
  let cursor = null, totalCount = 0;
  for (let page = 0; page < MAX_REPO_PAGES; page++) {
    setLoading(`Leggo i repository… (${repos.length})`);
    const r = (await gql(Q_REPOS, { cursor })).viewer.repositories;
    totalCount = r.totalCount;
    repos.push(...r.nodes.filter(Boolean));
    if (!r.pageInfo.hasNextPage) break;
    cursor = r.pageInfo.endCursor;
  }

  // Traffico: solo repo su cui hai permessi di scrittura/amministrazione
  setLoading("Leggo il traffico dei repository…");
  const trafficCandidates = repos
    .filter((r) => ["ADMIN", "MAINTAIN", "WRITE"].includes(r.viewerPermission) && !r.isArchived)
    .slice(0, MAX_TRAFFIC_REPOS);
  const traffic = [];
  let trafficDenied = 0;
  await Promise.all(trafficCandidates.map(async (r) => {
    try {
      const [views, clones] = await Promise.all([
        rest(`/repos/${r.nameWithOwner}/traffic/views`),
        rest(`/repos/${r.nameWithOwner}/traffic/clones`),
      ]);
      traffic.push({ repo: r, views, clones });
    } catch (e) {
      if (e.status === 403 || e.status === 404) trafficDenied++;
    }
  }));

  return { profile, years, yearly, repos, totalRepoCount: totalCount, traffic, trafficDenied, trafficTried: trafficCandidates.length };
}

/* =========================================================
   Calcoli
   ========================================================= */
function computeStats(d) {
  const todayStr = localISO(new Date());

  // Tutti i giorni di tutti gli anni, senza duplicati, fino a oggi
  const dayMap = new Map();
  const totals = { commits: 0, prs: 0, reviews: 0, issues: 0, reposCreated: 0, restricted: 0, all: 0 };
  const perYear = [];
  for (const y of d.years) {
    const c = d.yearly[y];
    if (!c) continue;
    totals.commits += c.totalCommitContributions;
    totals.prs += c.totalPullRequestContributions;
    totals.reviews += c.totalPullRequestReviewContributions;
    totals.issues += c.totalIssueContributions;
    totals.reposCreated += c.totalRepositoryContributions;
    totals.restricted += c.restrictedContributionsCount;
    totals.all += c.contributionCalendar.totalContributions;
    perYear.push({ year: y, total: c.contributionCalendar.totalContributions });
    for (const w of c.contributionCalendar.weeks)
      for (const day of w.contributionDays)
        if (day.date <= todayStr) dayMap.set(day.date, day.contributionCount);
  }
  const days = [...dayMap.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));

  // Streak
  let longest = 0, longestEnd = null, run = 0;
  for (const dd of days) {
    if (dd.count > 0) { run++; if (run > longest) { longest = run; longestEnd = dd.date; } }
    else run = 0;
  }
  let i = days.length - 1;
  if (i >= 0 && days[i].date === todayStr && days[i].count === 0) i--; // oggi non è ancora finito
  let current = 0, currentStart = null;
  while (i >= 0 && days[i].count > 0) { current++; currentStart = days[i].date; i--; }

  // Giorno migliore, giorni attivi, giorno della settimana
  let best = null, activeDays = 0;
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  const monthTotals = new Map();
  for (const dd of days) {
    if (dd.count > 0) activeDays++;
    if (!best || dd.count > best.count) best = dd;
    weekday[parseISODate(dd.date).getDay()] += dd.count;
    const m = dd.date.slice(0, 7);
    monthTotals.set(m, (monthTotals.get(m) || 0) + dd.count);
  }
  let bestMonth = null;
  for (const [m, v] of monthTotals) if (!bestMonth || v > bestMonth.v) bestMonth = { m, v };

  // Ultimi 12 mesi per il calendario
  const since = new Date(); since.setDate(since.getDate() - 364);
  const sinceStr = localISO(since);
  const lastYear = days.filter((x) => x.date >= sinceStr);

  // Repository
  const own = d.repos.filter((r) => r.owner.login === d.profile.login);
  const ownNoFork = own.filter((r) => !r.isFork);
  const starsReceived = own.reduce((s, r) => s + r.stargazerCount, 0);
  const forksReceived = own.reduce((s, r) => s + r.forkCount, 0);
  const privateCount = d.repos.filter((r) => r.isPrivate).length;
  const topStarred = [...own].sort((a, b) => b.stargazerCount - a.stargazerCount)[0];
  const oldestRepo = [...own].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

  // Linguaggi (byte di codice, fork esclusi)
  const langs = new Map();
  for (const r of d.repos.filter((r) => !r.isFork))
    for (const e of r.languages.edges) langs.set(e.node.name, (langs.get(e.node.name) || 0) + e.size);
  const langTotal = [...langs.values()].reduce((a, b) => a + b, 0);
  const langList = [...langs.entries()].sort((a, b) => b[1] - a[1]);
  const topLangs = langList.slice(0, 7).map(([name, size]) => ({ name, size }));
  const others = langList.slice(7).reduce((acc, [, v]) => acc + v, 0);
  if (others > 0) topLangs.push({ name: "Altro", size: others });

  const created = new Date(d.profile.createdAt);
  const ageYears = (Date.now() - created) / (365.25 * 864e5);

  return {
    totals, perYear, days, lastYear, current, currentStart, longest, longestEnd,
    best, activeDays, weekday, bestMonth, starsReceived, forksReceived, privateCount,
    topStarred, oldestRepo, own, ownNoFork, topLangs, langTotal, langCount: langs.size,
    created, ageYears,
  };
}

/* =========================================================
   Rendering
   ========================================================= */
function renderProfile(p, s) {
  const meta = el("div", { class: "meta" },
    el("span", { text: `📅 Su GitHub dal ${df.format(s.created)}` }),
    p.location && el("span", { text: `📍 ${p.location}` }),
    p.company && el("span", { text: `🏢 ${p.company}` }),
    el("span", { text: `👥 ${nf.format(p.followers.totalCount)} follower · ${nf.format(p.following.totalCount)} seguiti` }),
  );
  $("profile").replaceChildren(
    el("img", { src: p.avatarUrl, alt: "", width: 72, height: 72 }),
    el("div", { class: "who" },
      el("a", { class: "name", href: p.url, target: "_blank", rel: "noopener", text: p.name || p.login }),
      el("span", { class: "muted", text: `@${p.login}` }),
      p.bio && el("span", { class: "small", text: p.bio }),
      meta,
    ),
  );
}

function tile(label, value, sub) {
  return el("div", { class: "tile" },
    el("div", { class: "label", text: label }),
    el("div", { class: "value", text: value }),
    sub && el("div", { class: "sub", text: sub }));
}

function renderTiles(d, s) {
  const years = s.ageYears >= 1 ? `${Math.floor(s.ageYears)} anni` : `${Math.max(1, Math.round(s.ageYears * 12))} mesi`;
  $("tiles").replaceChildren(
    tile("Iscritto da", years, df.format(s.created)),
    tile("Contributi totali", nf.format(s.totals.all), `di cui ${nf.format(s.totals.restricted)} privati`),
    tile("Streak attuale", `${nf.format(s.current)} ${s.current === 1 ? "giorno" : "giorni"}`,
      s.current ? `dal ${df.format(parseISODate(s.currentStart))}` : "fai un commit oggi!"),
    tile("Streak più lunga", `${nf.format(s.longest)} ${s.longest === 1 ? "giorno" : "giorni"}`,
      s.longestEnd ? `finita il ${df.format(parseISODate(s.longestEnd))}` : ""),
    tile("Repository", nf.format(d.totalRepoCount), `${nf.format(s.privateCount)} privati`),
    tile("Stelle ricevute", nf.format(s.starsReceived), `${nf.format(s.forksReceived)} fork`),
  );
}

function renderCalendar(s) {
  const days = s.lastYear;
  $("calendarTotal").textContent = `${nf.format(days.reduce((a, b) => a + b.count, 0))} contributi`;
  if (!days.length) { $("calendar").replaceChildren(el("p", { class: "muted", text: "Nessun contributo." })); return; }

  // Soglie per 4 livelli (quartili dei giorni attivi)
  const active = days.map((x) => x.count).filter((c) => c > 0).sort((a, b) => a - b);
  const q = (p) => active.length ? active[Math.min(active.length - 1, Math.floor(p * active.length))] : 1;
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75);
  const level = (c) => (c === 0 ? 0 : c <= t1 ? 1 : c <= t2 ? 2 : c <= t3 ? 3 : 4);

  const grid = el("div", { class: "calendar", role: "img", "aria-label": "Calendario dei contributi degli ultimi 12 mesi" });
  const firstDow = parseISODate(days[0].date).getDay();
  for (let i = 0; i < firstDow; i++) grid.append(el("span", { class: "cell empty" }));
  for (const dd of days) {
    const dt = parseISODate(dd.date);
    grid.append(el("span", {
      class: `cell lvl-${level(dd.count)}`,
      tabindex: "0",
      "data-tip": `${dd.count === 0 ? "Nessun" : nf.format(dd.count)} contribut${dd.count === 1 ? "o" : "i"} · ${WEEKDAYS[dt.getDay()]} ${df.format(dt)}`,
    }));
  }
  $("calendar").replaceChildren(grid);
  // parte dalla fine (mesi più recenti) su schermi stretti
  requestAnimationFrame(() => { $("calendar").scrollLeft = $("calendar").scrollWidth; });
}

function renderVBars(container, items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const bars = items.map((i) => el("div", { class: "vbar", tabindex: "0", "data-tip": i.tip },
    el("span", { class: "val", text: i.value ? nf.format(i.value) : "" }),
    el("div", { class: "bar", style: `height:${(i.value / max) * 100}%` })));
  container.replaceChildren(...bars);
  const labels = el("div", { class: "vbar-labels" }, items.map((i) => el("span", { text: i.label })));
  container.nextElementSibling?.classList?.contains("vbar-labels") && container.nextElementSibling.remove();
  container.after(labels);
}

function renderYears(s) {
  renderVBars($("chartYears"), s.perYear.map((y) => ({
    label: String(y.year), value: y.total, tip: `${y.year}: ${nf.format(y.total)} contributi`,
  })));
}

function renderWeekday(s) {
  // ordine Lun -> Dom
  const order = [1, 2, 3, 4, 5, 6, 0];
  const total = s.weekday.reduce((a, b) => a + b, 0) || 1;
  renderVBars($("chartWeekday"), order.map((i) => ({
    label: WEEKDAYS_SHORT[i], value: s.weekday[i],
    tip: `${WEEKDAYS[i]}: ${nf.format(s.weekday[i])} contributi (${Math.round((s.weekday[i] / total) * 100)}%)`,
  })));
}

function renderLanguages(s) {
  if (!s.topLangs.length) { $("chartLanguages").replaceChildren(el("p", { class: "muted", text: "Nessun dato sui linguaggi." })); return; }
  const max = s.topLangs[0].size;
  $("chartLanguages").replaceChildren(...s.topLangs.map((l) => {
    const pct = (l.size / s.langTotal) * 100;
    return el("div", { class: "hbar", tabindex: "0", "data-tip": `${l.name}: ${pct.toFixed(1)}% · ${formatBytes(l.size)}` },
      el("span", { class: "name", text: l.name }),
      el("div", { class: "track" }, el("div", { class: "fill", style: `width:${(l.size / max) * 100}%` })),
      el("span", { class: "pct", text: `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}%` }));
  }));
}

function formatBytes(b) {
  const u = ["B", "KB", "MB", "GB"]; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function renderFacts(d, s) {
  const p = d.profile;
  const facts = [];
  const add = (icon, ...parts) => facts.push(el("li", {}, el("span", { class: "icon", "aria-hidden": "true", text: icon }), el("span", {}, ...parts)));

  if (s.best && s.best.count > 0)
    add("🔥", "Giorno più produttivo: ", el("strong", { text: nf.format(s.best.count) }), ` contributi il ${df.format(parseISODate(s.best.date))}`);
  if (s.bestMonth)
    add("🗓️", "Mese record: ", el("strong", { text: new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(parseISODate(s.bestMonth.m + "-01")) }), ` con ${nf.format(s.bestMonth.v)} contributi`);
  const fav = s.weekday.indexOf(Math.max(...s.weekday));
  if (s.weekday[fav] > 0) add("📆", "Giorno preferito: ", el("strong", { text: WEEKDAYS[fav].toLowerCase() }));
  if (s.activeDays) add("⚡", "Giorni attivi: ", el("strong", { text: nf.format(s.activeDays) }), ` · media ${(s.totals.all / s.activeDays).toFixed(1)} contributi per giorno attivo`);
  add("💻", "Commit totali: ", el("strong", { text: nf.format(s.totals.commits) }), ` · review fatte: ${nf.format(s.totals.reviews)}`);
  if (p.pullRequests.totalCount)
    add("🔀", "Pull request: ", el("strong", { text: nf.format(p.pullRequests.totalCount) }), ` · ${Math.round((p.mergedPRs.totalCount / p.pullRequests.totalCount) * 100)}% unite`);
  add("🐛", "Issue aperte: ", el("strong", { text: nf.format(p.issues.totalCount) }));
  if (s.topLangs[0]) add("🧠", "Linguaggio principale: ", el("strong", { text: s.topLangs[0].name }), ` su ${s.langCount} usati`);
  if (s.topStarred && s.topStarred.stargazerCount > 0)
    add("⭐", "Repo più amato: ", el("a", { href: s.topStarred.url, target: "_blank", rel: "noopener", text: s.topStarred.name }), ` (${nf.format(s.topStarred.stargazerCount)} stelle)`);
  if (s.oldestRepo) add("🏛️", "Primo repository: ", el("strong", { text: s.oldestRepo.name }), ` (${df.format(new Date(s.oldestRepo.createdAt))})`);
  add("📝", "Gist: ", el("strong", { text: nf.format(p.gists.totalCount) }), ` · repo messi tra le stelle: ${nf.format(p.starredRepositories.totalCount)}`);

  $("facts").replaceChildren(...facts);
}

function renderTraffic(d) {
  const box = $("traffic");
  if (!d.traffic.length) {
    const msg = d.trafficTried === 0
      ? "Nessun repository con permessi di scrittura tra quelli accessibili all'app."
      : "Il traffico non è disponibile: l'app non ha il permesso “Administration: read” oppure non è installata su questi repository.";
    box.replaceChildren(el("p", { class: "muted", text: msg }));
    return;
  }
  const rows = [...d.traffic].sort((a, b) => b.views.count - a.views.count).map(({ repo, views, clones }) => {
    const max = Math.max(1, ...views.views.map((v) => v.count));
    const spark = el("div", { class: "spark", role: "img", "aria-label": `Visite giornaliere di ${repo.name}` },
      views.views.map((v) => el("span", {
        style: `height:${(v.count / max) * 100}%`,
        "data-tip": `${dfShort.format(new Date(v.timestamp))}: ${nf.format(v.count)} visite (${nf.format(v.uniques)} uniche)`,
      })));
    return el("tr", {},
      el("td", {}, el("a", { href: repo.url, target: "_blank", rel: "noopener", text: repo.name }), " ",
        repo.isPrivate ? el("span", { class: "badge badge-private", text: "privato" }) : null),
      el("td", { class: "num", text: nf.format(views.count) }),
      el("td", { class: "num", text: nf.format(views.uniques) }),
      el("td", { class: "num", text: nf.format(clones.count) }),
      el("td", { class: "num", text: nf.format(clones.uniques) }),
      el("td", {}, spark));
  });
  const table = el("table", { class: "table" },
    el("thead", {}, el("tr", {},
      el("th", { text: "Repository" }), el("th", { class: "num", text: "Visite" }), el("th", { class: "num", text: "Visitatori unici" }),
      el("th", { class: "num", text: "Cloni" }), el("th", { class: "num", text: "Cloni unici" }), el("th", { text: "Visite al giorno" }))),
    el("tbody", {}, rows));
  const note = d.trafficDenied
    ? el("p", { class: "small muted", text: `${d.trafficDenied} repository esclusi: permesso mancante.` })
    : null;
  box.replaceChildren(...[el("div", { class: "table-wrap" }, table), note].filter(Boolean));
}

/* ---------- Tabella repository con filtro e ordinamento ---------- */
let repoState = { list: [], sort: "pushedAt", dir: "desc", filter: "" };

function renderRepos(d) {
  repoState.list = d.repos.map((r) => ({
    name: r.nameWithOwner, url: r.url, description: r.description || "",
    visibility: r.isPrivate ? "privato" : "pubblico", isPrivate: r.isPrivate, isFork: r.isFork, isArchived: r.isArchived,
    language: r.primaryLanguage?.name || "", stars: r.stargazerCount, forks: r.forkCount, pushedAt: r.pushedAt || "",
  }));
  drawRepoTable();
}

function drawRepoTable() {
  const { sort, dir, filter } = repoState;
  const f = filter.toLowerCase();
  const list = repoState.list
    .filter((r) => !f || r.name.toLowerCase().includes(f) || r.language.toLowerCase().includes(f) || r.description.toLowerCase().includes(f))
    .sort((a, b) => {
      const va = a[sort], vb = b[sort];
      const c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "it");
      return dir === "asc" ? c : -c;
    });

  document.querySelectorAll("#repoTable th").forEach((th) => {
    th.classList.toggle("sorted-asc", th.dataset.sort === sort && dir === "asc");
    th.classList.toggle("sorted-desc", th.dataset.sort === sort && dir === "desc");
  });

  const rows = list.map((r) => el("tr", {},
    el("td", {},
      el("a", { href: r.url, target: "_blank", rel: "noopener", text: r.name, title: r.description || null }),
      r.isFork ? el("span", { class: "badge", style: "margin-left:6px", text: "fork" }) : null,
      r.isArchived ? el("span", { class: "badge", style: "margin-left:6px", text: "archiviato" }) : null),
    el("td", {}, el("span", { class: `badge ${r.isPrivate ? "badge-private" : ""}`, text: r.visibility })),
    el("td", { text: r.language || "—" }),
    el("td", { class: "num", text: nf.format(r.stars) }),
    el("td", { class: "num", text: nf.format(r.forks) }),
    el("td", { text: r.pushedAt ? df.format(new Date(r.pushedAt)) : "—" })));
  document.querySelector("#repoTable tbody").replaceChildren(...rows);
}

document.querySelectorAll("#repoTable th[data-sort]").forEach((th) => {
  th.tabIndex = 0;
  const go = () => {
    const key = th.dataset.sort;
    repoState.dir = repoState.sort === key && repoState.dir === "desc" ? "asc" : "desc";
    repoState.sort = key;
    drawRepoTable();
  };
  th.addEventListener("click", go);
  th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
});
$("repoFilter").addEventListener("input", (e) => { repoState.filter = e.target.value; drawRepoTable(); });

/* =========================================================
   Avvio
   ========================================================= */
async function main() {
  $("btnLogin").addEventListener("click", login);
  $("btnLogout").addEventListener("click", logout);
  if (CFG.APP_SLUG) $("btnInstall").href = `https://github.com/apps/${encodeURIComponent(CFG.APP_SLUG)}/installations/new`;

  if (!configOk()) {
    $("configWarning").textContent = "Configurazione incompleta: imposta CLIENT_ID e WORKER_URL nel file config.js.";
    $("configWarning").hidden = false;
    $("btnLogin").disabled = true;
    show("viewLogin");
    return;
  }

  try {
    await handleCallback();
  } catch (e) {
    showError(e.message);
    return;
  }

  if (!getToken()) { show("viewLogin"); return; }

  $("btnLogout").hidden = false;
  $("btnInstall").hidden = !CFG.APP_SLUG;

  try {
    const data = await fetchAll();
    const stats = computeStats(data);
    renderProfile(data.profile, stats);
    renderTiles(data, stats);
    renderCalendar(stats);
    renderYears(stats);
    renderWeekday(stats);
    renderLanguages(stats);
    renderFacts(data, stats);
    renderTraffic(data);
    renderRepos(data);
    show("viewDashboard");
  } catch (e) {
    console.error(e);
    if (!getToken()) { show("viewLogin"); return; }
    showError(e.message || String(e));
  }
}

main();
