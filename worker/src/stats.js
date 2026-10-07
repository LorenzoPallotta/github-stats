/**
 * Calcola i numeri della card partendo dal token dell'utente.
 * Versione ridotta di fetchAll + computeStats del sito: solo quello che serve alla card.
 */

const GQL = "https://api.github.com/graphql";
const MAX_REPO_PAGES = 10;

async function gql(token, query, variables = {}) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "github-stats-auth-worker",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) throw new Error("unauthorized");
  const j = await res.json().catch(() => ({}));
  if (!j.data) throw new Error((j.errors || []).map((e) => e.message).join("; ") || `HTTP ${res.status}`);
  return j.data;
}

const Q_PROFILE = `query { viewer { login name createdAt contributionsCollection { contributionYears } } }`;

const Q_REPOS = `
query($cursor: String) {
  viewer {
    repositories(first: 100, after: $cursor,
                 ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        isPrivate isFork stargazerCount
        owner { login }
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
      }
    }
  }
}`;

function yearsQuery(years, nowIso) {
  const thisYear = Number(nowIso.slice(0, 4));
  const parts = years.map((y) => {
    const to = y === thisYear ? nowIso : `${y}-12-31T23:59:59Z`;
    return `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${to}") {
      totalCommitContributions restrictedContributionsCount
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }`;
  });
  return `query { viewer { ${parts.join("\n")} } }`;
}

// "Oggi" nel fuso dell'utente, formato YYYY-MM-DD
function todayIn(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function buildCard(token, timeZone) {
  const nowIso = new Date().toISOString();
  const profile = (await gql(token, Q_PROFILE)).viewer;

  // Numero di PR: facoltativo, l'app potrebbe non avere il permesso
  let pullRequests = null;
  try {
    pullRequests = (await gql(token, "query { viewer { pullRequests { totalCount } } }")).viewer.pullRequests?.totalCount ?? null;
  } catch {}

  // Contributi, a gruppi di 3 anni
  const years = [...profile.contributionsCollection.contributionYears].sort((a, b) => a - b);
  const todayStr = todayIn(timeZone);
  const dayMap = new Map();
  let total = 0, restricted = 0, commits = 0, prsFromCalendar = 0;
  for (let i = 0; i < years.length; i += 3) {
    const chunk = years.slice(i, i + 3);
    const data = (await gql(token, yearsQuery(chunk, nowIso))).viewer;
    for (const y of chunk) {
      const c = data[`y${y}`];
      if (!c) continue;
      total += c.contributionCalendar.totalContributions;
      restricted += c.restrictedContributionsCount;
      commits += c.totalCommitContributions;
      for (const w of c.contributionCalendar.weeks)
        for (const d of w.contributionDays)
          if (d.date <= todayStr) dayMap.set(d.date, d.contributionCount);
    }
  }

  // Streak (stessa logica del sito)
  const days = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let longest = 0, run = 0;
  for (const [, n] of days) {
    if (n > 0) { run++; if (run > longest) longest = run; } else run = 0;
  }
  let i = days.length - 1;
  if (i >= 0 && days[i][0] === todayStr && days[i][1] === 0) i--; // oggi non è ancora finito
  let current = 0;
  while (i >= 0 && days[i][1] > 0) { current++; i--; }

  // Repository
  const repos = [];
  let cursor = null, repoCount = 0;
  for (let page = 0; page < MAX_REPO_PAGES; page++) {
    const r = (await gql(token, Q_REPOS, { cursor })).viewer.repositories;
    repoCount = r.totalCount;
    repos.push(...r.nodes.filter(Boolean));
    if (!r.pageInfo.hasNextPage) break;
    cursor = r.pageInfo.endCursor;
  }
  const own = repos.filter((r) => r.owner.login === profile.login);

  // Linguaggi (fork esclusi)
  const langs = new Map();
  for (const r of repos.filter((r) => !r.isFork))
    for (const e of r.languages.edges) {
      const l = langs.get(e.node.name) || { size: 0, color: e.node.color };
      l.size += e.size;
      langs.set(e.node.name, l);
    }
  const langTotal = [...langs.values()].reduce((s, l) => s + l.size, 0);
  const languages = [...langs.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5)
    .map(([name, l]) => ({ name, pct: langTotal ? (l.size / langTotal) * 100 : 0, color: l.color }));

  return {
    login: profile.login,
    name: profile.name || profile.login,
    since: new Date(profile.createdAt).getFullYear(),
    totalContributions: total,
    privateContributions: restricted,
    currentStreak: current,
    longestStreak: longest,
    commits,
    pullRequests: pullRequests ?? 0,
    stars: own.reduce((s, r) => s + r.stargazerCount, 0),
    repos: repoCount,
    privateRepos: repos.filter((r) => r.isPrivate).length,
    languages,
  };
}
