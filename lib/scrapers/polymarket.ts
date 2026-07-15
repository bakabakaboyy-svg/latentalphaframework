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

interface PolymarketTeam {
  name: string;
  ordering: "home" | "away" | string;
}

interface PolymarketMarket {
  question: string;
  outcomes: string; // JSON-encoded string[], e.g. '["Team A","Team B"]'
  outcomePrices: string; // JSON-encoded string[] of probabilities, e.g. '["0.65","0.35"]'
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
    const prices = parseJsonArray(winMarket.outcomePrices).map(Number);
    if (outcomes.length !== prices.length) continue;

    const lines: OddsLine[] = [];
    for (let i = 0; i < outcomes.length; i++) {
      const probability = prices[i];
      if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
        continue; // degenerate/resolved market — no meaningful price to show
      }
      lines.push({
        bookSlug: "polymarket",
        marketType: "h2h",
        outcomeName: outcomes[i],
        price: convertProbabilityToAmericanOdds(probability),
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
