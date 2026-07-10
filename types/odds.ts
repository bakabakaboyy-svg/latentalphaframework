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

// Row shape returned by GET /api/odds — one row per book per outcome, latest snapshot only
export interface OddsApiRow {
  gameId: number;
  externalId: string;
  sportSlug: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  status: string;
  bookSlug: string;
  bookName: string;
  isSharp: boolean;
  marketType: MarketType;
  outcomeName: string;
  price: number;
  point: number | null;
  recordedAt: string;
}
