import type { GameOdds, OddsLine } from "@/types/odds";
import { convertProbabilityToAmericanOdds } from "@/lib/utils/normalizeOdds";

// Polymarket's public "gamma" API — no auth needed, confirmed working.
// (The URL suggested for this session, polymarket.com/api, 404s — it doesn't
// exist. This is the real one their own site calls.)
//
// Coverage note: Polymarket only has genuine daily per-game markets (team vs.
// team, with structured home/away team data) for MLB right now — checked via
// their /tags endpoint and a few /events?tag_slug=... probes. WNBA and Soccer
// only have season-long futures there (Champion, MVP, etc.), which don't fit
// our per-game schema, so this scraper is MLB-only for now — same kind of gap
// as Tennis/CS2 not being on Action Network.
//
// Polymarket is technically geo-restricted for US users, but the API itself
// is publicly reachable with no auth. Use at your own risk.
const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const FETCH_TIMEOUT_MS = 10_000;

// Polymarket's sports taker fee, confirmed against their official docs
// (docs.polymarket.com/trading/fees) as of July 2026: fee = shares × feeRate
// × p × (1-p), charged only to takers (i.e. anyone crossing the spread to
// execute immediately — exactly what "buy this side right now" means). This
// rate has changed before (0.03 -> 0.05 earlier this year) and could again;
// check the docs if displayed prices stop matching Polymarket's own site.
const SPORTS_TAKER_FEE_RATE = 0.05;

// The true cost to buy `side` right now: the ask price you'd pay to cross
// the spread, plus Polymarket's taker fee on that trade. This is
// deliberately NOT the fair/mid probability (outcomePrices) — a "no-vig"
// price looks correct in isolation but doesn't reflect what actually lands
// in your account if you tap buy, and this app exists to compare real,
// executable prices against sportsbook lines (which always include their
// vig), not to compare a sportsbook's real price against Polymarket's
// theoretical one.
function executionPrice(askPrice: number): number {
  return askPrice + SPORTS_TAKER_FEE_RATE * askPrice * (1 - askPrice);
}

interface PolymarketTeam {
  name: string;
  ordering: "home" | "away" | string;
}

interface PolymarketMarket {
  question: string;
  outcomes: string; // JSON-encoded string[], e.g. '["Team A","Team B"]'
  outcomePrices: string; // JSON-encoded string[] of probabilities — the (bestBid+bestAsk)/2 midpoint, NOT an executable price
  bestBid?: number; // best live order-book bid for outcomes[0]
  bestAsk?: number; // best live order-book ask for outcomes[0] — what you'd actually pay to buy it right now
  closed: boolean;
  active: boolean;
}

interface PolymarketEvent {
  id: string;
  title: string;
  startTime?: string; // ISO 8601 — full scheduled start time
  eventDate?: string; // date-only, less precise; startTime is preferred
  teams?: PolymarketTeam[];
  markets: PolymarketMarket[];
  closed: boolean;
  active: boolean;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// Finds the moneyline/"win" market within an event's markets, as opposed to
// prop/spread/total markets Polymarket also lists under the same event
// ("Will there be a run in the 1st inning?", "Spread: National (-1.5)", etc).
//
// Primary signal: the market whose `question` matches the event's own
// `title` — this is Polymarket's own "this is the headline market" marker,
// and holds even when `event.teams[].name` (short names) and the win
// market's own outcome labels are phrased differently. Confirmed necessary
// via a real bug: for the All-Star Game, event.teams uses "American"/
// "National", but the actual win market's outcomes are "American League"/
// "National League" — matching outcomes against team names (the fallback
// below) instead found the *Spread* sub-market, whose outcomes happen to be
// the literal short team names, and silently mislabeled spread probabilities
// as the moneyline.
function findWinMarket(event: PolymarketEvent): PolymarketMarket | null {
  const byTitle = event.markets.find((m) => m.question === event.title);
  if (byTitle && parseJsonArray(byTitle.outcomes).length === 2) return byTitle;

  // Fallback for events where the title doesn't exactly match any market's
  // question: a market whose two outcomes are exactly the two team names.
  const home = event.teams?.find((t) => t.ordering === "home");
  const away = event.teams?.find((t) => t.ordering === "away");
  if (!home || !away) return null;
  for (const market of event.markets) {
    const outcomes = parseJsonArray(market.outcomes);
    if (outcomes.length === 2 && outcomes.includes(home.name) && outcomes.includes(away.name)) {
      return market;
    }
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Fetches live MLB game-winner odds from Polymarket and normalizes them into
// our GameOdds shape, converting each side's probability to American odds so
// it can sit in the same price column as sportsbook lines. Polymarket only
// exposes a moneyline-equivalent ("who wins") market per game — no spread or
// total — so every line here has marketType "h2h".
export async function scrapePolymarketMLB(): Promise<GameOdds[]> {
  const url = `${GAMMA_API_BASE}/events?tag_slug=mlb&closed=false&limit=100&order=startDate&ascending=true`;
  console.log("[polymarket:mlb] Fetching", url);

  let events: PolymarketEvent[];
  try {
    events = await fetchJson<PolymarketEvent[]>(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[polymarket:mlb] Fetch failed: ${message}`);
  }

  console.log(`[polymarket:mlb] Fetched ${events.length} events.`);

  const results: GameOdds[] = [];

  for (const event of events) {
    const home = event.teams?.find((t) => t.ordering === "home");
    const away = event.teams?.find((t) => t.ordering === "away");
    if (!home || !away) {
      continue; // futures/props events (no team-vs-team structure) — not a game
    }

    const winMarket = findWinMarket(event);
    if (!winMarket) {
      console.log(`[polymarket:mlb] No win market found for ${away.name} @ ${home.name}, skipping.`);
      continue;
    }

    const outcomes = parseJsonArray(winMarket.outcomes);
    const midPrices = parseJsonArray(winMarket.outcomePrices).map(Number);
    if (outcomes.length !== midPrices.length || outcomes.length !== 2) continue;

    // Polymarket's outcomePrices for a single market are normally
    // complementary (sum to 1) by construction — flag it if that ever
    // breaks, since a bad sum would mean the market data itself is off.
    const midSum = midPrices.reduce((sum, p) => sum + p, 0);
    if (Number.isFinite(midSum) && Math.abs(midSum - 1) > 0.001) {
      console.warn(
        `[polymarket:mlb] ${away.name} @ ${home.name}: outcomePrices sum to ${midSum.toFixed(4)}, expected ~1.0 — ${JSON.stringify(winMarket.outcomePrices)}`
      );
    }

    // Real executable ask price per side: outcomes[0] trades directly on
    // bestAsk; outcomes[1] is the complementary side, so its buy price is
    // 1 - bestBid (selling outcomes[0] at the bid is economically the same
    // trade as buying outcomes[1]). Falls back to the fair-value midpoint
    // (no spread, no fee) only if live order-book data is missing — better
    // to show a slightly-optimistic price than none at all for an otherwise
    // valid market.
    const hasOrderBook =
      Number.isFinite(winMarket.bestBid) &&
      Number.isFinite(winMarket.bestAsk) &&
      (winMarket.bestBid as number) > 0 &&
      (winMarket.bestAsk as number) < 1;

    const askPrices = hasOrderBook
      ? [winMarket.bestAsk as number, 1 - (winMarket.bestBid as number)]
      : midPrices;

    if (!hasOrderBook) {
      console.warn(
        `[polymarket:mlb] ${away.name} @ ${home.name}: no live bid/ask, falling back to fair-value midpoint (no spread/fee applied).`
      );
    }

    const lines: OddsLine[] = [];
    for (let i = 0; i < outcomes.length; i++) {
      const askPrice = askPrices[i];
      if (!Number.isFinite(askPrice) || askPrice <= 0 || askPrice >= 1) {
        continue; // degenerate/resolved market — no meaningful price to show
      }
      const allInProbability = hasOrderBook ? executionPrice(askPrice) : askPrice;
      if (allInProbability <= 0 || allInProbability >= 1) continue;
      lines.push({
        bookSlug: "polymarket",
        marketType: "h2h",
        outcomeName: outcomes[i],
        price: convertProbabilityToAmericanOdds(allInProbability),
        point: null,
      });
    }

    if (lines.length === 0) continue;

    const commenceTime = event.startTime ?? event.eventDate;
    if (!commenceTime) continue;

    results.push({
      externalId: `pm-${event.id}`,
      sportSlug: "mlb",
      homeTeam: home.name,
      awayTeam: away.name,
      commenceTime,
      status: "upcoming",
      lines,
    });

    console.log(`[polymarket:mlb] ${away.name} @ ${home.name}: ${lines.length} lines.`);
  }

  console.log(`[polymarket:mlb] Done. ${results.length} games parsed.`);
  return results;
}
