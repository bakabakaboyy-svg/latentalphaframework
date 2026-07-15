import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getLatestGamesWithOdds, latestRecordedAt } from "@/lib/odds";
import type { OddsResponse } from "@/types/odds";

// GET /api/odds?sport=mlb&market_type=h2h&book=fanduel
// Returns every matching game with its most recent odds line per
// (book, market, outcome) nested underneath it, plus the most recent
// recorded_at across the whole result as `lastUpdated`.
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const sportSlug = searchParams.get("sport");
    const marketType = searchParams.get("market_type");
    const bookSlug = searchParams.get("book");

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
        const detail = sportError ? sportError.message : `no row for slug "${sportSlug}"`;
        return NextResponse.json(
          { games: [], lastUpdated: null, error: `Unknown sport: ${sportSlug} (${detail})` } satisfies OddsResponse,
          { status: 400 }
        );
      }
      gamesQuery = gamesQuery.eq("sport_id", sport.id);
    }

    const { data: games, error: gamesError } = await gamesQuery;
    if (gamesError) throw new Error(`Failed to load games: ${gamesError.message}`);

    if (!games || games.length === 0) {
      return NextResponse.json({ games: [], lastUpdated: null } satisfies OddsResponse);
    }

    // Resolve book filter -> book id
    let bookId: number | null = null;
    if (bookSlug) {
      const { data: book, error: bookError } = await supabase
        .from("books")
        .select("id")
        .eq("slug", bookSlug)
        .single();

      if (bookError || !book) {
        return NextResponse.json(
          { games: [], lastUpdated: null, error: `Unknown book: ${bookSlug}` } satisfies OddsResponse,
          { status: 400 }
        );
      }
      bookId = book.id;
    }

    const gamesWithOdds = await getLatestGamesWithOdds(
      supabase,
      games.map((g) => ({ ...g, sports: g.sports as unknown as { slug: string } | null })),
      { marketType, bookId }
    );

    return NextResponse.json(
      { games: gamesWithOdds, lastUpdated: latestRecordedAt(gamesWithOdds) } satisfies OddsResponse
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[odds] Failed:", message);
    return NextResponse.json({ games: [], lastUpdated: null, error: message } satisfies OddsResponse, { status: 500 });
  }
}
