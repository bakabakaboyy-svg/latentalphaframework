import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { MarketType, SteamMove, SteamResponse } from "@/types/odds";

const DEFAULT_HOURS = 24;

function emptyResponse(error?: string): SteamResponse {
  return { steamMoves: [], totalSteamMoves: 0, mostActiveGame: null, mostCommonTriggerBook: null, error };
}

// GET /api/steam?sport=mlb&market_type=h2h&hours=24
// Returns steam_moves detected in the last `hours` (default 24), newest
// first, optionally filtered to one sport and/or market. `hours=1` is what
// the STEAM tab's LIVE MODE uses under the hood.
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const sportSlug = searchParams.get("sport");
    const marketType = searchParams.get("market_type") as MarketType | null;
    const hoursParam = searchParams.get("hours");
    const hours = hoursParam ? Number(hoursParam) : DEFAULT_HOURS;

    if (!Number.isFinite(hours) || hours <= 0) {
      return NextResponse.json(emptyResponse("hours must be a positive number"), { status: 400 });
    }

    let gameIds: number[] | null = null;
    const gameById = new Map<number, { homeTeam: string; awayTeam: string; sportSlug: string }>();

    if (sportSlug) {
      const { data: sport, error: sportError } = await supabase
        .from("sports")
        .select("id")
        .eq("slug", sportSlug)
        .single();
      if (sportError || !sport) {
        return NextResponse.json(emptyResponse(`Unknown sport: ${sportSlug}`), { status: 400 });
      }
      const { data: games, error: gamesError } = await supabase
        .from("games")
        .select("id, home_team, away_team")
        .eq("sport_id", sport.id);
      if (gamesError) throw new Error(`Failed to load games: ${gamesError.message}`);
      gameIds = (games ?? []).map((g) => g.id);
      for (const g of games ?? []) gameById.set(g.id, { homeTeam: g.home_team, awayTeam: g.away_team, sportSlug });
      if (gameIds.length === 0) return NextResponse.json(emptyResponse());
    }

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from("steam_moves")
      .select(
        "id, game_id, market_type, outcome_name, direction, trigger_book, price_before, price_after, books_moved, detected_at, games(home_team, away_team, sports(slug))"
      )
      .gte("detected_at", cutoff)
      .order("detected_at", { ascending: false });

    if (gameIds) query = query.in("game_id", gameIds);
    if (marketType) query = query.eq("market_type", marketType);

    const { data: rows, error: steamError } = await query;
    if (steamError) throw new Error(`Failed to load steam_moves: ${steamError.message}`);

    const steamMoves: SteamMove[] = (rows ?? []).map((row) => {
      const game = row.games as unknown as { home_team: string; away_team: string; sports: { slug: string } | null } | null;
      const sport = game?.sports as unknown as { slug: string } | null;
      return {
        id: row.id,
        gameId: row.game_id,
        homeTeam: game?.home_team ?? "",
        awayTeam: game?.away_team ?? "",
        sportSlug: sport?.slug ?? "",
        marketType: row.market_type as MarketType,
        outcomeName: row.outcome_name,
        direction: row.direction as SteamMove["direction"],
        triggerBook: row.trigger_book ?? "",
        priceBefore: Number(row.price_before),
        priceAfter: Number(row.price_after),
        booksMoved: row.books_moved,
        detectedAt: row.detected_at,
      };
    });

    let mostActiveGame: string | null = null;
    let mostCommonTriggerBook: string | null = null;

    if (steamMoves.length > 0) {
      const gameCounts = new Map<string, number>();
      const triggerCounts = new Map<string, number>();
      for (const move of steamMoves) {
        const gameLabel = `${move.awayTeam} @ ${move.homeTeam}`;
        gameCounts.set(gameLabel, (gameCounts.get(gameLabel) ?? 0) + 1);
        triggerCounts.set(move.triggerBook, (triggerCounts.get(move.triggerBook) ?? 0) + 1);
      }
      mostActiveGame = [...gameCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      mostCommonTriggerBook = [...triggerCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    return NextResponse.json({
      steamMoves,
      totalSteamMoves: steamMoves.length,
      mostActiveGame,
      mostCommonTriggerBook,
    } satisfies SteamResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[steam] Failed:", message);
    return NextResponse.json(emptyResponse(message), { status: 500 });
  }
}
