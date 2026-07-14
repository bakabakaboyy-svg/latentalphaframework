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
  errors: string[];
  scrapedAt: string;
}

// One priced outcome within a GET /api/odds game entry — latest snapshot only
export interface OddsLineApi {
  bookSlug: string;
  bookName: string;
  isSharp: boolean;
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
