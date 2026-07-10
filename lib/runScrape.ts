import { getSupabaseAdmin } from "@/lib/supabase";
import { scrapeActionNetworkMLB } from "@/lib/scrapers/actionNetwork";
import type { ScrapeResult } from "@/types/odds";

// Scrapes Action Network, upserts games, records one immutable odds_snapshots
// row per line, and locks in opening_lines the first time we see a given
// game/book/market/outcome combination. Shared by /api/scrape (the
// cron-secret-protected route Railway will hit every minute) and
// /api/scrape/manual (the route the dashboard's Refresh button calls).
export async function runScrape(): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    success: false,
    gamesFound: 0,
    gamesUpserted: 0,
    snapshotsInserted: 0,
    openingLinesSet: 0,
    errors: [],
    scrapedAt: new Date().toISOString(),
  };

  try {
    const supabase = getSupabaseAdmin();

    console.log("[scrape] Loading books + sports lookup tables...");
    const [{ data: books, error: booksError }, { data: sports, error: sportsError }] =
      await Promise.all([
        supabase.from("books").select("id, slug"),
        supabase.from("sports").select("id, slug"),
      ]);

    if (booksError) throw new Error(`Failed to load books: ${booksError.message}`);
    if (sportsError) throw new Error(`Failed to load sports: ${sportsError.message}`);

    const bookIdBySlug = new Map((books ?? []).map((b) => [b.slug, b.id]));
    const sportIdBySlug = new Map((sports ?? []).map((s) => [s.slug, s.id]));

    console.log("[scrape] Running Action Network scraper...");
    const games = await scrapeActionNetworkMLB();
    result.gamesFound = games.length;

    if (games.length === 0) {
      result.success = true;
      return result;
    }

    // 1. Upsert games (matched on external_id, which is stable across scrapes)
    const gameRows = games.map((g) => ({
      external_id: g.externalId,
      sport_id: sportIdBySlug.get(g.sportSlug) ?? null,
      home_team: g.homeTeam,
      away_team: g.awayTeam,
      commence_time: g.commenceTime,
      status: g.status,
    }));

    console.log(`[scrape] Upserting ${gameRows.length} games...`);
    const { data: upsertedGames, error: gamesError } = await supabase
      .from("games")
      .upsert(gameRows, { onConflict: "external_id" })
      .select("id, external_id");

    if (gamesError) throw new Error(`Failed to upsert games: ${gamesError.message}`);

    result.gamesUpserted = upsertedGames?.length ?? 0;
    const gameIdByExternalId = new Map(
      (upsertedGames ?? []).map((g) => [g.external_id, g.id])
    );

    // 2. Flatten every line from every game into snapshot candidate rows
    type SnapshotRow = {
      game_id: number;
      book_id: number;
      market_type: string;
      outcome_name: string;
      price: number;
      point: number | null;
    };

    const snapshotRows: SnapshotRow[] = [];
    for (const game of games) {
      const gameId = gameIdByExternalId.get(game.externalId);
      if (!gameId) {
        result.errors.push(`No id returned for game ${game.externalId}, skipping its lines.`);
        continue;
      }
      for (const line of game.lines) {
        const bookId = bookIdBySlug.get(line.bookSlug);
        if (!bookId) {
          result.errors.push(`Unknown book slug "${line.bookSlug}", skipping line.`);
          continue;
        }
        snapshotRows.push({
          game_id: gameId,
          book_id: bookId,
          market_type: line.marketType,
          outcome_name: line.outcomeName,
          price: line.price,
          point: line.point,
        });
      }
    }

    if (snapshotRows.length === 0) {
      result.success = true;
      return result;
    }

    // 3. Insert into opening_lines with ON CONFLICT DO NOTHING (via
    // ignoreDuplicates). Postgres only returns rows it actually inserted, so
    // whatever comes back here is the set of lines opening for the first time.
    console.log(`[scrape] Recording opening lines for ${snapshotRows.length} candidate lines...`);
    const { data: newlyOpened, error: openingError } = await supabase
      .from("opening_lines")
      .upsert(
        snapshotRows.map((r) => ({ ...r, recorded_at: result.scrapedAt })),
        {
          onConflict: "game_id,book_id,market_type,outcome_name",
          ignoreDuplicates: true,
        }
      )
      .select("game_id, book_id, market_type, outcome_name");

    if (openingError) throw new Error(`Failed to upsert opening_lines: ${openingError.message}`);

    result.openingLinesSet = newlyOpened?.length ?? 0;
    const openedKeys = new Set(
      (newlyOpened ?? []).map(
        (r) => `${r.game_id}|${r.book_id}|${r.market_type}|${r.outcome_name}`
      )
    );

    // 4. Insert the immutable snapshot for every line, flagging the ones that
    // just became opening lines.
    console.log(`[scrape] Inserting ${snapshotRows.length} odds snapshots...`);
    const { data: insertedSnapshots, error: snapshotError } = await supabase
      .from("odds_snapshots")
      .insert(
        snapshotRows.map((r) => ({
          ...r,
          is_opening: openedKeys.has(`${r.game_id}|${r.book_id}|${r.market_type}|${r.outcome_name}`),
          recorded_at: result.scrapedAt,
        }))
      )
      .select("id");

    if (snapshotError) throw new Error(`Failed to insert odds_snapshots: ${snapshotError.message}`);

    result.snapshotsInserted = insertedSnapshots?.length ?? 0;
    result.success = true;

    console.log(
      `[scrape] Done. games=${result.gamesUpserted} snapshots=${result.snapshotsInserted} newOpeningLines=${result.openingLinesSet}`
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scrape] Failed:", message);
    result.errors.push(message);
    return result;
  }
}
