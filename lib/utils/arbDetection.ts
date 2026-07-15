import type { GameWithOdds, MarketType } from "@/types/odds";
import { calculateArbitrage, detectThreeWayArb, type ArbLegInput, type ArbLegResult } from "./noVigCalculator";

export interface ArbOpportunity {
  id: string; // stable per (gameId, marketType, point) — React keys + "still active" diffing across refreshes
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  sportSlug: string;
  marketType: MarketType;
  point: number | null; // shared line point for totals/spreads groups; null for h2h
  legs: ArbLegResult[]; // 2 legs (any market) or 3 legs (soccer h2h home/draw/away)
  isThreeWay: boolean;
  arbPercentage: number;
  detectedAt: string;
}

// Groups a game's current odds into markets we can actually compare
// apples-to-apples:
//   h2h     -> one group per game (2 outcomes normally, 3 for soccer w/ Draw)
//   totals  -> one group per exact point value (Over 8.5 only pairs with Under 8.5)
//   spreads -> one group per |point| (Home -1.5 pairs with Away +1.5)
// Within each group, only the single best (highest) price per outcome name
// is kept — that's the only price worth comparing for arb purposes.
function groupLines(game: GameWithOdds, marketType: MarketType) {
  const groups = new Map<string, Map<string, ArbLegInput>>();

  for (const line of game.odds) {
    if (line.marketType !== marketType) continue;

    const groupKey = marketType === "h2h" ? "h2h" : marketType === "totals" ? String(line.point) : String(Math.abs(line.point ?? 0));

    let outcomes = groups.get(groupKey);
    if (!outcomes) {
      outcomes = new Map();
      groups.set(groupKey, outcomes);
    }

    const existing = outcomes.get(line.outcomeName);
    if (!existing || line.price > existing.odds) {
      outcomes.set(line.outcomeName, {
        outcomeName: line.outcomeName,
        odds: line.price,
        bookSlug: line.bookSlug,
        bookName: line.bookName,
      });
    }
  }

  return groups;
}

// Scans every game's current odds (as returned by GET /api/odds / getLatestGamesWithOdds)
// for two-way and three-way arbitrage across books, including prediction
// markets (Kalshi/Polymarket odds are already normalized to American odds
// upstream, so they compare directly).
export function detectAllArbs(games: GameWithOdds[], minArbPercentage: number = 0.5): ArbOpportunity[] {
  const marketTypes: MarketType[] = ["h2h", "spreads", "totals"];
  const opportunities: ArbOpportunity[] = [];

  for (const game of games) {
    // A game is only arb-eligible if it hasn't started yet. `status` alone
    // isn't reliable — Action Network stops returning a game once it's old
    // without always flipping it from "upcoming"/"live" to "final" first, so
    // games days past their commence_time can sit there indefinitely with
    // stale prices. commence_time is the authoritative signal: once a game's
    // start time has passed, books stop updating it and any pre-game arb
    // math no longer reflects a real, currently-bettable opportunity.
    if (game.status === "final") continue;
    if (new Date(game.commenceTime).getTime() <= Date.now()) continue;

    for (const marketType of marketTypes) {
      const groups = groupLines(game, marketType);

      // Soccer moneyline always has 3 real outcomes (Home/Away/Draw) — if
      // this scrape only captured 2 of them, the missing outcome's price is
      // exactly what would normally balance the book, and comparing just the
      // other two produces a huge fake "arb" (two individual longshot prices
      // that were never meant to be compared against each other alone). Skip
      // incomplete soccer h2h groups entirely rather than mis-detecting them
      // as a valid 2-way arb.
      const isSoccerMoneyline = marketType === "h2h" && game.sportSlug === "soccer";

      for (const [groupKey, outcomes] of groups) {
        const legs = Array.from(outcomes.values());
        if (legs.length < 2) continue;
        if (isSoccerMoneyline && legs.length !== 3) continue;

        const point = marketType === "h2h" ? null : Number(groupKey);
        const detectedAt = new Date().toISOString();
        const id = `${game.id}-${marketType}-${point ?? "ml"}`;

        if (legs.length === 2) {
          const result = calculateArbitrage([legs[0], legs[1]], minArbPercentage);
          if (!result) continue;
          opportunities.push({
            id,
            gameId: game.id,
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            sportSlug: game.sportSlug,
            marketType,
            point,
            legs: result.legs,
            isThreeWay: false,
            arbPercentage: result.arbPercentage,
            detectedAt,
          });
          console.log(
            `[arb] 2-way arb: ${legs[0].outcomeName} ${legs[0].odds} (${legs[0].bookName}) vs ${legs[1].outcomeName} ${legs[1].odds} (${legs[1].bookName}) = ${result.arbPercentage.toFixed(2)}% arb`
          );
        } else if (legs.length === 3 && marketType === "h2h") {
          const result = detectThreeWayArb([legs[0], legs[1], legs[2]], minArbPercentage);
          if (!result) continue;
          opportunities.push({
            id,
            gameId: game.id,
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            sportSlug: game.sportSlug,
            marketType,
            point,
            legs: result.legs,
            isThreeWay: true,
            arbPercentage: result.arbPercentage,
            detectedAt,
          });
          console.log(
            `[arb] 3-way arb: ${legs.map((l) => `${l.outcomeName} ${l.odds} (${l.bookName})`).join(" / ")} = ${result.arbPercentage.toFixed(2)}% arb`
          );
        }
        // >3 legs (shouldn't happen for spreads/totals/h2h) is skipped.
      }
    }
  }

  return opportunities.sort((a, b) => b.arbPercentage - a.arbPercentage);
}
