import { describe, expect, it } from "vitest";
import {
  additiveDevig,
  consensusDevig,
  multiplicativeDevig,
  powerModelDevig,
  probitDevig,
  shinsDevig,
} from "../devigging";

// American -110 -> decimal 1.9091, used throughout as the canonical
// symmetric-market fixture (matches the hand-checked value used for the
// equivalent Python models in quant_engine's math_utils.py this session).
const EVEN_ODDS = 1.9091;

function sumsToOne(probs: number[], tol = 0.001) {
  const total = probs.reduce((s, p) => s + p, 0);
  expect(total).toBeGreaterThan(1 - tol);
  expect(total).toBeLessThan(1 + tol);
}

describe("multiplicativeDevig", () => {
  it("-110/-110 -> ~0.5/0.5", () => {
    const [a, b] = multiplicativeDevig([EVEN_ODDS, EVEN_ODDS]);
    expect(a).toBeCloseTo(0.5, 2);
    expect(b).toBeCloseTo(0.5, 2);
    sumsToOne([a, b]);
  });
});

describe("additiveDevig", () => {
  it("-110/-110 -> ~0.5/0.5", () => {
    const [a] = additiveDevig([EVEN_ODDS, EVEN_ODDS]);
    expect(a).toBeCloseTo(0.5, 2);
  });

  it("diverges from multiplicativeDevig for an asymmetric market", () => {
    // -300 favorite / +250 underdog
    const oddsA = 1 + 100 / 300; // decimal ~1.3333
    const oddsB = 1 + 250 / 100; // decimal 3.5
    const [multA] = multiplicativeDevig([oddsA, oddsB]);
    const [addA] = additiveDevig([oddsA, oddsB]);
    expect(Math.abs(multA - addA)).toBeGreaterThan(0.001);
  });
});

describe("powerModelDevig", () => {
  it("sums to ~1.0 and shrinks the favorite less than the underdog", () => {
    const oddsFav = 1 + 100 / 120; // -120 favorite, decimal ~1.8333
    const oddsDog = 2.0; // +100 underdog
    const rawFav = 1 / oddsFav;
    const rawDog = 1 / oddsDog;

    const [powFav, powDog] = powerModelDevig([oddsFav, oddsDog]);
    sumsToOne([powFav, powDog]);

    const shrinkFav = (rawFav - powFav) / rawFav;
    const shrinkDog = (rawDog - powDog) / rawDog;
    expect(shrinkFav).toBeLessThan(shrinkDog);
  });

  it("diverges from multiplicativeDevig for a favorite/longshot pair", () => {
    const oddsFav = 1.2;
    const oddsDog = 5.5;
    const [multFav] = multiplicativeDevig([oddsFav, oddsDog]);
    const [powFav] = powerModelDevig([oddsFav, oddsDog]);
    expect(Math.abs(multFav - powFav)).toBeGreaterThan(0.001);
  });
});

describe("probitDevig", () => {
  it("sums to ~1.0", () => {
    const probs = probitDevig([1.8333, 2.0]);
    sumsToOne(probs);
  });

  it("-110/-110 -> ~0.5/0.5", () => {
    const [a] = probitDevig([EVEN_ODDS, EVEN_ODDS]);
    expect(a).toBeCloseTo(0.5, 2);
  });
});

describe("shinsDevig", () => {
  it("2-outcome case equals additiveDevig exactly", () => {
    const oddsA = 1.3333;
    const oddsB = 3.5;
    const shin = shinsDevig([oddsA, oddsB]);
    const additive = additiveDevig([oddsA, oddsB]);
    expect(shin[0]).toBeCloseTo(additive[0], 6);
    expect(shin[1]).toBeCloseTo(additive[1], 6);
  });

  it("3-outcome (soccer) case sums to ~1.0", () => {
    // Home/Draw/Away roughly +150 / +220 / -135
    const oddsHome = 2.5;
    const oddsDraw = 3.2;
    const oddsAway = 1.7407;
    const probs = shinsDevig([oddsHome, oddsDraw, oddsAway]);
    sumsToOne(probs);
    expect(probs).toHaveLength(3);
  });
});

describe("consensusDevig", () => {
  it("requires at least one book", () => {
    expect(() => consensusDevig({}, "buy_yes")).toThrow();
  });

  it("buy_yes takes the minimum across models, buy_no the maximum, for the same book", () => {
    const booksOdds = { pinnacle: [1.3333, 3.5] };
    const yesResult = consensusDevig(booksOdds, "buy_yes", 0);
    const noResult = consensusDevig(booksOdds, "buy_no", 0);
    expect(yesResult.worstCaseUsed.pinnacle).toBeLessThanOrEqual(noResult.worstCaseUsed.pinnacle);
  });

  it("averages the worst-case value across multiple books present", () => {
    const booksOdds = {
      pinnacle: [1.8333, 2.0],
      circa: [1.85, 1.98],
    };
    const result = consensusDevig(booksOdds, "buy_yes", 0);
    const expectedAvg = (result.worstCaseUsed.pinnacle + result.worstCaseUsed.circa) / 2;
    expect(result.consensusProb).toBeCloseTo(expectedAvg, 9);
    expect(Object.keys(result.perModelBreakdown)).toEqual(["pinnacle", "circa"]);
  });
});
