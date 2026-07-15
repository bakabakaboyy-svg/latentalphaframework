// Shared types for odds data, mirroring the Supabase schema in /lib/schema.sql

export type MarketType = "h2h" | "spreads" | "totals";

export type BookSlug =
  | "pinnacle"
  | "circa"
  | "fanduel"
  | "draftkings"
  | "betmgm"
  | "action-network"
  | "kalshi"
  | "polymarket"
  | "limitless"
  | "coinbase"
  | "robinhood";

export type SportSlug = "mlb" | "wnba" | "tennis" | "soccer" | "cs2";

// One priced outcome at one book for one game (e.g. "Yankees -1.5 @ FanDuel: -110")
export interface OddsLine {
  bookSlug: BookSlug;
  marketType: MarketType;
  outcomeName: string; // team name, or "Over"/"Under"
  price: number; // American odds, e.g. -110, +150
  point: number | null; // spread or total line; null for moneyline
}

export type GameStatus = "upcoming" | "live" | "final";

// A single game with all books' current lines attached — what the scraper returns
export interface GameOdds {
  externalId: string; // stable id from the source, used to upsert into `games`
  sportSlug: SportSlug;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string; // ISO 8601
  status: GameStatus;
  lines: OddsLine[];
}

// Result summary returned by POST /api/scrape
export interface ScrapeResult {
  success: boolean;
  gamesFound: number;
  gamesUpserted: number;
  snapshotsInserted: number;
  openingLinesSet: number;
  steamMovesDetected: number;
  arbitrageOpportunitiesFound: number;
  sources: string[]; // scrapers that ran this pass, e.g. ["action-network", "polymarket"]
  errors: string[];
  scrapedAt: string;
}

// One priced outcome within a GET /api/odds game entry — latest snapshot only
export interface OddsLineApi {
  bookSlug: string;
  bookName: string;
  isSharp: boolean;
  isPredictionMarket: boolean; // true for Kalshi/Polymarket — a converted probability, not a bookmaker's quote
  marketType: MarketType;
  outcomeName: string;
  price: number;
  point: number | null;
  recordedAt: string;
}

// A game with all of its current odds lines attached — one element of GET /api/odds's `games` array
export interface GameWithOdds {
  id: number;
  externalId: string;
  sportSlug: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  status: GameStatus;
  odds: OddsLineApi[];
}

// GET /api/odds response body
export interface OddsResponse {
  games: GameWithOdds[];
  lastUpdated: string | null;
  error?: string;
}

// A single book's price for one outcome — used for both opening and current lines in GET /api/movement
export interface MovementLineEntry {
  bookSlug: string;
  bookName: string;
  isSharp: boolean;
  isPredictionMarket: boolean; // true for Kalshi/Polymarket — a converted probability, not a bookmaker's quote
  outcomeName: string;
  price: number;
  point: number | null;
  recordedAt: string;
}

export interface MovementPricePoint {
  time: string; // ISO 8601
  price: number;
  point: number | null;
}

// Full price history for one (book, outcome) pair — one line on the price-history chart
export interface MovementSeries {
  bookSlug: string;
  bookName: string;
  isSharp: boolean;
  isPredictionMarket: boolean;
  outcomeName: string;
  points: MovementPricePoint[];
}

// The book treated as "the" market open for one outcome (see first_recorded_book
// comment in lib/schema.sql — a display choice, not a detected timing signal)
export interface MovementReferenceOpen {
  outcomeName: string;
  bookSlug: string;
  bookName: string;
  price: number;
  point: number | null;
}

// GET /api/movement response body
export interface MovementResponse {
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  marketType: MarketType;
  openingLines: MovementLineEntry[];
  currentLines: MovementLineEntry[];
  priceHistory: MovementSeries[];
  referenceOpens: MovementReferenceOpen[];
  error?: string;
}

export type SteamDirection = "up" | "down";

// A detected steam move — 3+ books' prices moving the same direction within
// a short window. See lib/utils/steamDetection.ts for the algorithm and its
// caveats (notably: "trigger book" is a best-guess, not a genuine
// first-mover detection, for the same reason first_recorded_book is).
export interface SteamMove {
  id: number;
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  sportSlug: string;
  marketType: MarketType;
  outcomeName: string;
  direction: SteamDirection;
  triggerBook: string;
  priceBefore: number;
  priceAfter: number;
  booksMoved: number; // books other than triggerBook that followed it
  detectedAt: string;
}

// GET /api/steam response body
export interface SteamResponse {
  steamMoves: SteamMove[];
  totalSteamMoves: number;
  mostActiveGame: string | null;
  mostCommonTriggerBook: string | null;
  error?: string;
}

export type BetStatus = "open" | "closed" | "graded";

// A logged bet. currentPrice/clvPercentage are live-computed against the
// latest odds_snapshot while status is "open"; once closed, clvPercentage is
// the final value stored at close time (see PUT /api/clv) and currentPrice
// no longer changes.
export interface BetEntry {
  id: number;
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  marketType: MarketType;
  outcomeName: string;
  point: number | null;
  bookSlug: string;
  bookName: string;
  entryPrice: number;
  currentPrice: number | null; // null if no matching odds_snapshot exists yet
  stake: number | null;
  entryTime: string;
  closingPrice: number | null;
  clvPercentage: number | null;
  status: BetStatus;
}

// GET /api/clv response body
export interface CLVResponse {
  bets: BetEntry[];
  error?: string;
}

// POST /api/clv request body — log a new bet
export interface LogBetRequest {
  gameId: number;
  marketType: MarketType;
  outcomeName: string;
  point: number | null;
  bookSlug: string;
  entryPrice: number;
  stake: number | null;
  entryTime: string | null; // omit/null to default to now()
}

export interface LogBetResponse {
  success: boolean;
  betId?: number;
  clvPercentage?: number | null;
  error?: string;
}

// PUT /api/clv request body — mark a bet closed/graded
export interface UpdateBetRequest {
  betId: number;
  status: "closed" | "graded";
  closingPrice: number;
}

export interface UpdateBetResponse {
  success: boolean;
  finalClvPercentage?: number;
  error?: string;
}

// One side of an arbitrage opportunity — the best available price for one
// outcome, at the book offering it.
export interface ArbLeg {
  outcomeName: string;
  odds: number;
  bookSlug: string;
  bookName: string;
  impliedProb: number; // raw, vig-included implied probability of this leg's price
  betSplit: number; // fraction of total stake to place on this leg, sums to 1 across all legs
}

// A detected arbitrage opportunity — guaranteed profit if you bet every leg
// at its listed book. 2 legs for h2h/spreads/totals, 3 legs for soccer h2h
// (Home/Draw/Away). Computed live from current odds on every request, not
// read from arbitrage_opportunities (see lib/utils/arbDetection.ts) — that
// table is a historical log used only for the 24h stats card.
export interface ArbOpportunity {
  id: string; // stable per (gameId, marketType, point) across refreshes — React key + "still active" diffing
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  sportSlug: string;
  marketType: MarketType;
  point: number | null; // shared line point for spreads/totals; null for h2h
  legs: ArbLeg[];
  isThreeWay: boolean;
  arbPercentage: number;
  detectedAt: string;
}

// Derived from the arbitrage_opportunities historical log over the last 24h.
export interface ArbStats {
  totalDetected24h: number;
  activeNow: number;
  highestArbPercentage24h: number | null;
  mostCommonMarket: string | null; // display label, e.g. "MONEYLINE"
  mostProfitableBookPair: string | null; // e.g. "FanDuel ↔ DraftKings"
}

// GET /api/arb response body
export interface ArbResponse {
  arbitrageOpportunities: ArbOpportunity[];
  totalArbsAvailable: number;
  highestArbPercentage: number | null;
  stats: ArbStats;
  error?: string;
}
