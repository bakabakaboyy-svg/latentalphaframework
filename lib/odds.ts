import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameWithOdds, OddsLineApi } from "@/types/odds";

// Shared "latest odds per game" loader — used by GET /api/odds and by the
// ARB tab's live arb detection, so both see the exact same current-price
// data instead of two independent queries drifting apart.
//
// One bounded query per game_id rather than a single query with a blanket
// limit ordered by recorded_at across every requested game. With a global
// limit, games whose snapshots happen to be older than the N-th most recent
// snapshot *across every other requested game combined* silently got zero
// odds back — a real bug found in Session 7 when "all sports" (a much bigger
// combined snapshot pool than any single sport) starved out a game that had
// plenty of its own recent data. Per-game queries guarantee every requested
// game gets its own fair share.
const PER_GAME_SNAPSHOT_LIMIT = 150;

interface GameRow {
  id: number;
  external_id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  status: string;
  sport_id: number | null;
  sports: { slug: string } | null;
}

export async function getLatestGamesWithOdds(
  supabase: SupabaseClient,
  games: GameRow[],
  options: { marketType?: string | null; bookId?: number | null } = {}
): Promise<GameWithOdds[]> {
  if (games.length === 0) return [];
  const gameIds = games.map((g) => g.id);

  const snapshotBatches = await Promise.all(
    gameIds.map(async (gameId) => {
      let q = supabase
        .from("odds_snapshots")
        .select("id, game_id, book_id, market_type, outcome_name, price, point, recorded_at, books(slug, name, is_sharp, type)")
        .eq("game_id", gameId)
        .order("recorded_at", { ascending: false })
        .limit(PER_GAME_SNAPSHOT_LIMIT);

      if (options.marketType) q = q.eq("market_type", options.marketType);
      if (options.bookId) q = q.eq("book_id", options.bookId);

      const { data, error } = await q;
      if (error) throw new Error(`Failed to load odds_snapshots for game ${gameId}: ${error.message}`);
      return data ?? [];
    })
  );
  const snapshots = snapshotBatches.flat();

  // De-dupe to the most recent snapshot per (game, book, market, outcome).
  const seen = new Set<string>();
  const oddsByGameId = new Map<number, OddsLineApi[]>();

  for (const snap of snapshots) {
    const key = `${snap.game_id}|${snap.book_id}|${snap.market_type}|${snap.outcome_name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const book = snap.books as unknown as { slug: string; name: string; is_sharp: boolean; type: string } | null;
    if (!book) continue;

    const line: OddsLineApi = {
      bookSlug: book.slug,
      bookName: book.name,
      isSharp: book.is_sharp,
      isPredictionMarket: book.type === "prediction_market",
      marketType: snap.market_type as OddsLineApi["marketType"],
      outcomeName: snap.outcome_name,
      price: Number(snap.price),
      point: snap.point === null ? null : Number(snap.point),
      recordedAt: snap.recorded_at,
    };

    const existing = oddsByGameId.get(snap.game_id);
    if (existing) existing.push(line);
    else oddsByGameId.set(snap.game_id, [line]);
  }

  return games.map((game) => ({
    id: game.id,
    externalId: game.external_id,
    sportSlug: game.sports?.slug ?? "",
    homeTeam: game.home_team,
    awayTeam: game.away_team,
    commenceTime: game.commence_time,
    status: game.status as GameWithOdds["status"],
    odds: oddsByGameId.get(game.id) ?? [],
  }));
}

// Most recent recorded_at across a set of GameWithOdds, or null if none have odds.
export function latestRecordedAt(games: GameWithOdds[]): string | null {
  let latest: string | null = null;
  for (const game of games) {
    for (const line of game.odds) {
      if (!latest || line.recordedAt > latest) latest = line.recordedAt;
    }
  }
  return latest;
}
