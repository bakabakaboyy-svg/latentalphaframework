import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { OddsApiRow } from "@/types/odds";

// GET /api/odds?sport=mlb&market_type=h2h&book=fanduel
// Returns the most recent odds_snapshots row per (game, book, market, outcome).
//
// We fetch a generous, recency-ordered batch of snapshots and de-duplicate in
// JS rather than writing a Postgres view — simplest thing that works at
// single-user MVP data volumes. Revisit with a `DISTINCT ON` view if the
// snapshot table gets big enough that this becomes slow.
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const sportSlug = searchParams.get("sport");
    const marketType = searchParams.get("market_type");
    const bookSlug = searchParams.get("book");

    let gameIds: number[] | null = null;

    // Resolve sport filter -> list of game ids
    let gamesQuery = supabase
      .from("games")
      .select("id, external_id, home_team, away_team, commence_time, status, sport_id, sports(slug)")
      .order("commence_time", { ascending: true });

    if (sportSlug) {
      const { data: sport, error: sportError } = await supabase
        .from("sports")
        .select("id")
        .eq("slug", sportSlug)
        .single();

      if (sportError || !sport) {
        return NextResponse.json({ rows: [], error: `Unknown sport: ${sportSlug}` }, { status: 400 });
      }
      gamesQuery = gamesQuery.eq("sport_id", sport.id);
    }

    const { data: games, error: gamesError } = await gamesQuery;
    if (gamesError) throw new Error(`Failed to load games: ${gamesError.message}`);

    if (!games || games.length === 0) {
      return NextResponse.json({ rows: [] satisfies OddsApiRow[] });
    }

    gameIds = games.map((g) => g.id);
    const gameById = new Map(games.map((g) => [g.id, g]));

    // Resolve book filter -> book id
    let bookId: number | null = null;
    if (bookSlug) {
      const { data: book, error: bookError } = await supabase
        .from("books")
        .select("id")
        .eq("slug", bookSlug)
        .single();

      if (bookError || !book) {
        return NextResponse.json({ rows: [], error: `Unknown book: ${bookSlug}` }, { status: 400 });
      }
      bookId = book.id;
    }

    let snapshotsQuery = supabase
      .from("odds_snapshots")
      .select("id, game_id, book_id, market_type, outcome_name, price, point, recorded_at, books(slug, name, is_sharp)")
      .in("game_id", gameIds)
      .order("recorded_at", { ascending: false })
      .limit(5000);

    if (marketType) snapshotsQuery = snapshotsQuery.eq("market_type", marketType);
    if (bookId) snapshotsQuery = snapshotsQuery.eq("book_id", bookId);

    const { data: snapshots, error: snapshotsError } = await snapshotsQuery;
    if (snapshotsError) throw new Error(`Failed to load odds_snapshots: ${snapshotsError.message}`);

    const seen = new Set<string>();
    const rows: OddsApiRow[] = [];

    for (const snap of snapshots ?? []) {
      const key = `${snap.game_id}|${snap.book_id}|${snap.market_type}|${snap.outcome_name}`;
      if (seen.has(key)) continue; // already have a more recent snapshot for this combo
      seen.add(key);

      const game = gameById.get(snap.game_id);
      const book = snap.books as unknown as { slug: string; name: string; is_sharp: boolean } | null;
      if (!game || !book) continue;

      const sport = game.sports as unknown as { slug: string } | null;

      rows.push({
        gameId: game.id,
        externalId: game.external_id,
        sportSlug: sport?.slug ?? "",
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        commenceTime: game.commence_time,
        status: game.status,
        bookSlug: book.slug,
        bookName: book.name,
        isSharp: book.is_sharp,
        marketType: snap.market_type as OddsApiRow["marketType"],
        outcomeName: snap.outcome_name,
        price: Number(snap.price),
        point: snap.point === null ? null : Number(snap.point),
        recordedAt: snap.recorded_at,
      });
    }

    return NextResponse.json({ rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[odds] Failed:", message);
    return NextResponse.json({ rows: [], error: message }, { status: 500 });
  }
}
