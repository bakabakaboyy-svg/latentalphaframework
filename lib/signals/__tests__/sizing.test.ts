import { describe, expect, it } from "vitest";
import { evPercent, expectedProfit, kellyFraction, kellyStake, projectedIrr } from "../sizing";

describe("kellyFraction", () => {
  it("hand-checked: p=0.60, C=0.50 -> f*=0.20", () => {
    // f* = (0.6 - 0.5) / (1 - 0.5) = 0.2
    expect(kellyFraction(0.6, 0.5)).toBeCloseTo(0.2, 6);
  });

  it("can be negative when there's no edge", () => {
    expect(kellyFraction(0.4, 0.5)).toBeLessThan(0);
  });

  it("rejects out-of-range contract prices", () => {
    expect(() => kellyFraction(0.5, 0)).toThrow();
    expect(() => kellyFraction(0.5, 1)).toThrow();
  });
});

describe("kellyStake", () => {
  it("hand-checked: p=0.60, C=0.50, $10k bankroll, quarter-Kelly -> $500", () => {
    // full Kelly 0.2 * 0.25 fraction * $10,000 = $500
    expect(kellyStake(0.6, 0.5, 10000, 0.25)).toBe(500);
  });

  it("clamps negative edge to $0, not a short position", () => {
    expect(kellyStake(0.4, 0.5, 10000, 0.25)).toBe(0);
  });

  it("rounds to the nearest dollar", () => {
    const stake = kellyStake(0.55, 0.5, 10000, 0.25);
    expect(Number.isInteger(stake)).toBe(true);
  });
});

describe("evPercent", () => {
  it("positive when consensus beats price", () => {
    // Matches quant_engine's own hand-checked example: ~7% EV
    const ev = evPercent(0.62, 0.58);
    expect(ev).toBeGreaterThan(0);
    expect(ev).toBeCloseTo(0.0689, 3);
  });

  it("zero at fair price", () => {
    expect(evPercent(0.5, 0.5)).toBeCloseTo(0, 9);
  });

  it("negative when price beats consensus", () => {
    expect(evPercent(0.45, 0.55)).toBeLessThan(0);
  });
});

describe("expectedProfit", () => {
  it("scales evPercent by the stake", () => {
    const stake = 500;
    const ev = evPercent(0.62, 0.58);
    expect(expectedProfit(stake, 0.62, 0.58)).toBeCloseTo(stake * ev, 6);
  });
});

describe("projectedIrr", () => {
  it("is positive for a positive EV and grows with more compounding cycles", () => {
    const irrFast = projectedIrr(0.05, 3); // recycles every 3 days
    const irrSlow = projectedIrr(0.05, 30); // recycles every 30 days
    expect(irrFast).toBeGreaterThan(0);
    expect(irrFast).toBeGreaterThan(irrSlow);
  });

  it("is zero for zero EV", () => {
    expect(projectedIrr(0, 3)).toBeCloseTo(0, 9);
  });
});
