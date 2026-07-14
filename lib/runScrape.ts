import { getSupabaseAdmin } from "@/lib/supabase";
import { scrapeActionNetworkSport, SUPPORTED_SPORTS } from "@/lib/scrapers/actionNetwork";
import type { GameOdds, ScrapeResult } from "@/types/odds";

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
        supabase.from("books").select("id, slug, is_sharp"),
        supabase.from("sports").select("id, slug"),
      ]);

    if (booksError) throw new Error(`Failed to load books: ${booksError.message}`);
    if (sportsError) throw new Error(`Failed to load sports: ${sportsError.message}`);

    const bookIdBySlug = new Map((books ?? []).map((b) => [b.slug, b.id]));
    const bookInfoById = new Map(
      (books ?? []).map((b) => [b.id, { slug: b.slug as string, isSharp: b.is_sharp as boolean }])
    );
    const sportIdBySlug = new Map((sports ?? []).map((s) => [s.slug, s.id]));

    console.log(`[scrape] Running Action Network scraper for ${SUPPORTED_SPORTS.join(", ")}...`);
    const games: GameOdds[] = [];
    for (const sportSlug of SUPPORTED_SPORTS) {
      try {
        const sportGames = await scrapeActionNetworkSport(sportSlug);
        games.push(...sportGames);
      } catch (err) {
        // One sport's page erroring (e.g. Action Network hiccup) shouldn't
        // block the others from being scraped and saved.
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`[${sportSlug}] ${message}`);
      }
    }
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

    // Pick one "reference" book per (game, market, outcome) — the book whose
    // opening price we treat as *the* market open for display purposes (e.g.
    // "Opened: -110 (Pinnacle)"). Prefers a sharp book if one posted a line,
    // else falls back to whichever book slug sorts first alphabetically.
    // NOTE: Action Network hands us one snapshot of every book at once per
    // scrape, not a live feed, so this is a display choice — we have no way
    // to detect which book *genuinely* posted first in real time.
    const referenceByGroup = new Map<string, { slug: string; isSharp: boolean }>();
    for (const row of snapshotRows) {
      const key = `${row.game_id}|${row.market_type}|${row.outcome_name}`;
      const info = bookInfoById.get(row.book_id);
      if (!info) continue;
      const current = referenceByGroup.get(key);
      if (!current || (info.isSharp && !current.isSharp) || (info.isSharp === current.isSharp && info.slug < current.slug)) {
        referenceByGroup.set(key, info);
      }
    }

    // 3. Insert into opening_lines with ON CONFLICT DO NOTHING (via
    // ignoreDuplicates). Postgres only returns rows it actually inserted, so
    // whatever comes back here is the set of lines opening for the first time.
    console.log(`[scrape] Recording opening lines for ${snapshotRows.length} candidate lines...`);
    const { data: newlyOpened, error: openingError } = await supabase
      .from("opening_lines")
      .upsert(
        snapshotRows.map((r) => ({
          ...r,
          first_recorded_book: referenceByGroup.get(`${r.game_id}|${r.market_type}|${r.outcome_name}`)?.slug ?? null,
          recorded_at: result.scrapedAt,
        })),
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

    // Log games where every line just opened for the first time this scrape
    // (as opposed to a game we already knew about that merely picked up one
    // more book).
    const gameInfoById = new Map<number, GameOdds>();
    for (const game of games) {
      const gameId = gameIdByExternalId.get(game.externalId);
      if (gameId !== undefined) gameInfoById.set(gameId, game);
    }
    const rowsByGameId = new Map<number, typeof snapshotRows>();
    for (const row of snapshotRows) {
      const arr = rowsByGameId.get(row.game_id);
      if (arr) arr.push(row);
      else rowsByGameId.set(row.game_id, [row]);
    }
    for (const [gameId, rows] of rowsByGameId) {
      const allNew = rows.every((r) =>
        openedKeys.has(`${r.game_id}|${r.book_id}|${r.market_type}|${r.outcome_name}`)
      );
      if (!allNew) continue;
      const info = gameInfoById.get(gameId);
      if (!info) continue;
      const bookCount = new Set(rows.map((r) => r.book_id)).size;
      console.log(
        `[scrape] New game detected: ${info.awayTeam} @ ${info.homeTeam}. Opening lines recorded from ${bookCount} books.`
      );
    }

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
