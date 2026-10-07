import { describe, it, expect } from "vitest";
import { cardOptions, renderCard, renderMissing, gradeOf } from "../src/card.js";

const opts = (q = "") => cardOptions(new URLSearchParams(q));

const card = (over = {}) => ({
  login: "octocat",
  name: "Octo Cat",
  totalContributions: 335,
  privateContributions: 312,
  currentStreak: 3,
  longestStreak: 5,
  commits: 18,
  pullRequests: 0,
  stars: 7,
  repos: 12,
  privateRepos: 8,
  languages: [
    { name: "JavaScript", pct: 40, color: "#f1e05a" },
    { name: "Python", pct: 30, color: "#3572A5" },
  ],
  updatedAt: "2026-10-07T08:40:05.796Z",
  ...over,
});

describe("cardOptions", () => {
  it("usa i valori predefiniti", () => {
    const o = opts();
    expect(o).toMatchObject({ theme: "light", langs: "bar", grade: false, calendar: false });
    expect([...o.hide]).toEqual([]);
  });

  it("ignora i valori sconosciuti", () => {
    const o = opts("theme=blue&langs=spiral&hide=foo,stars,bar");
    expect(o.theme).toBe("light");
    expect(o.langs).toBe("bar");
    expect([...o.hide]).toEqual(["stars"]);
  });

  it("accetta true, 1 e yes per grade e calendar", () => {
    expect(opts("grade=true&calendar=1")).toMatchObject({ grade: true, calendar: true });
    expect(opts("grade=YES")).toMatchObject({ grade: true });
    expect(opts("grade=false&calendar=0")).toMatchObject({ grade: false, calendar: false });
  });
});

describe("gradeOf", () => {
  it("dà C e punteggio 0 a chi non ha niente", () => {
    expect(gradeOf(card({ totalContributions: 0, longestStreak: 0, stars: 0, pullRequests: 0 })))
      .toEqual({ score: 0, letter: "C" });
  });

  it("riproduce l'esempio di COME-FUNZIONA.md (C+, circa 0,337)", () => {
    const g = gradeOf(card());
    expect(g.letter).toBe("C+");
    expect(g.score).toBeCloseTo(0.337, 3);
  });

  it("dà S a numeri molto alti", () => {
    expect(gradeOf(card({ totalContributions: 1e5, longestStreak: 1e3, stars: 1e4, pullRequests: 1e4 })).letter).toBe("S");
  });

  it("tratta le PR mancanti (null) come 0", () => {
    expect(gradeOf(card({ pullRequests: null })).score).toBeCloseTo(gradeOf(card({ pullRequests: 0 })).score);
  });
});

describe("renderCard", () => {
  it("disegna la card standard larga 500px", () => {
    const svg = renderCard(card(), opts());
    expect(svg).toMatch(/^<svg [^>]*width="500"/);
    expect(svg).toContain("Total contributions");
    expect(svg).toContain("Top languages");
  });

  it("fa l'escape dei testi", () => {
    const svg = renderCard(card({ name: "<script>alert(1)</script>" }), opts());
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("nasconde le righe scelte con hide", () => {
    const svg = renderCard(card(), opts("hide=private,stars"));
    expect(svg).not.toContain("Private contributions");
    expect(svg).not.toContain("Stars earned");
    expect(svg).toContain("Commits");
  });

  it("nasconde la riga delle PR se il numero manca", () => {
    expect(renderCard(card({ pullRequests: null }), opts())).not.toContain("Pull requests");
    expect(renderCard(card({ pullRequests: 0 }), opts())).toContain("Pull requests");
  });

  it("con langs=hide la card è stretta e senza lingue", () => {
    const svg = renderCard(card(), opts("langs=hide"));
    expect(svg).toMatch(/^<svg [^>]*width="280"/);
    expect(svg).not.toContain("Top languages");
  });

  it("più righe nascoste = card più bassa", () => {
    const h = (q) => Number(renderCard(card(), opts(q)).match(/height="(\d+)"/)[1]);
    expect(h("langs=hide&hide=private,streak,longest,commits")).toBeLessThan(h("langs=hide"));
  });

  it("mostra il voto solo se richiesto", () => {
    expect(renderCard(card(), opts())).not.toContain('class="grade"');
    expect(renderCard(card(), opts("grade=true"))).toContain(">C+</text>");
  });

  it("il calendario compare solo se la card ha i dati giorno per giorno", () => {
    expect(renderCard(card(), opts("calendar=true"))).not.toContain("weeks</text>");
    const withDays = card({ recent: Array(371).fill(1), recentEnd: "2026-10-07" });
    const svg = renderCard(withDays, opts("calendar=true"));
    expect(svg).toContain("Last 45 weeks");
    // 2026-10-07 è mercoledì: 44 settimane piene + 4 giorni (dom-mer)
    expect(svg.match(/rx="2"/g)).toHaveLength(44 * 7 + 4);
  });

  it("disegna ciambella e torta", () => {
    for (const style of ["donut", "pie"]) {
      const svg = renderCard(card(), opts(`langs=${style}`));
      expect(svg).toContain('pathLength="100"');
      expect(svg).not.toContain('clip-path="url(#bar)"');
    }
  });
});

describe("renderMissing", () => {
  it("fa l'escape del login", () => {
    expect(renderMissing("<x>", "light")).toContain("@&lt;x&gt;");
  });
});
