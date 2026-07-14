import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type {
  MarketType,
  MovementLineEntry,
  MovementReferenceOpen,
  MovementResponse,
  MovementSeries,
} from "@/types/odds";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function emptyResponse(error: string): MovementResponse {
  return {
    gameId: 0,
    homeTeam: "",
    awayTeam: "",
    commenceTime: "",
    marketType: "h2h",
    openingLines: [],
    currentLines: [],
    priceHistory: [],
    referenceOpens: [],
    error,
  };
}

// GET /api/movement?game_id=1&market_type=h2h
// Everything the MOVEMENT tab needs for one game+market: the opening line per
// book/outcome, the full price history (last 2 hours, or everything we have
// if the game is newer than that), the latest ("current") price per
// book/outcome, and a reference-open pick per outcome for the tab's subheader.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const gameIdParam = searchParams.get("game_id");
  const marketType = (searchParams.get("market_type") ?? "h2h") as MarketType;

  const gameId = gameIdParam ? Number(gameIdParam) : NaN;
  if (!gameIdParam || Number.isNaN(gameId)) {
    return NextResponse.json(emptyResponse("game_id query param is required and must be a number"), { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id, home_team, away_team, commence_time")
      .eq("id", gameId)
      .single();

    if (gameError || !game) {
      return NextResponse.json(emptyResponse(`Game ${gameId} not found`), { status: 404 });
    }

    const { data: openingRows, error: openingError } = await supabase
      .from("opening_lines")
      .select("outcome_name, price, point, recorded_at, first_recorded_book, books(slug, name, is_sharp, type)")
      .eq("game_id", gameId)
      .eq("market_type", marketType);

    if (openingError) throw new Error(`Failed to load opening_lines: ${openingError.message}`);

    const openingLines: MovementLineEntry[] = (openingRows ?? []).map((row) => {
      const book = row.books as unknown as { slug: string; name: string; is_sharp: boolean; type: string };
      return {
        bookSlug: book.slug,
        bookName: book.name,
        isSharp: book.is_sharp,
        isPredictionMarket: book.type === "prediction_market",
        outcomeName: row.outcome_name,
        price: Number(row.price),
        point: row.point === null ? null : Number(row.point),
        recordedAt: row.recorded_at,
      };
    });

    const referenceOpens: MovementReferenceOpen[] = (openingRows ?? [])
      .filter((row) => {
        const book = row.books as unknown as { slug: string };
        return book.slug === row.first_recorded_book;
      })
      .map((row) => {
        const book = row.books as unknown as { slug: string; name: string };
        return {
          outcomeName: row.outcome_name,
          bookSlug: book.slug,
          bookName: book.name,
          price: Number(row.price),
          point: row.point === null ? null : Number(row.point),
        };
      });

    // Full price history, windowed to the last 2 hours — unless that window
    // is empty (a brand-new game with only its opening scrape so far, or a
    // game whose most recent scrape happened to land outside the window),
    // in which case we fall back to everything we have rather than showing
    // an empty chart.
    const snapshotsQuery = supabase
      .from("odds_snapshots")
      .select("book_id, outcome_name, price, point, recorded_at, books(slug, name, is_sharp, type)")
      .eq("game_id", gameId)
      .eq("market_type", marketType)
      .order("recorded_at", { ascending: true });

    const cutoff = new Date(Date.now() - TWO_HOURS_MS).toISOString();
    const { data: windowedSnapshots, error: windowedError } = await snapshotsQuery.gte("recorded_at", cutoff);
    if (windowedError) throw new Error(`Failed to load odds_snapshots: ${windowedError.message}`);

    let snapshots = windowedSnapshots ?? [];
    if (snapshots.length === 0) {
      const { data: allSnapshots, error: allError } = await supabase
        .from("odds_snapshots")
        .select("book_id, outcome_name, price, point, recorded_at, books(slug, name, is_sharp, type)")
        .eq("game_id", gameId)
        .eq("market_type", marketType)
        .order("recorded_at", { ascending: true });
      if (allError) throw new Error(`Failed to load odds_snapshots: ${allError.message}`);
      snapshots = allSnapshots ?? [];
    }

    const seriesByKey = new Map<string, MovementSeries>();
    const currentByKey = new Map<string, MovementLineEntry>();

    for (const snap of snapshots) {
      const book = snap.books as unknown as { slug: string; name: string; is_sharp: boolean; type: string } | null;
      if (!book) continue;
      const key = `${book.slug}|${snap.outcome_name}`;
      const isPredictionMarket = book.type === "prediction_market";

      const point = snap.point === null ? null : Number(snap.point);
      const price = Number(snap.price);

      let series = seriesByKey.get(key);
      if (!series) {
        series = {
          bookSlug: book.slug,
          bookName: book.name,
          isSharp: book.is_sharp,
          isPredictionMarket,
          outcomeName: snap.outcome_name,
          points: [],
        };
        seriesByKey.set(key, series);
      }
      series.points.push({ time: snap.recorded_at, price, point });

      // Rows arrive ascending by recorded_at, so the last write per key is the latest.
      currentByKey.set(key, {
        bookSlug: book.slug,
        bookName: book.name,
        isSharp: book.is_sharp,
        isPredictionMarket,
        outcomeName: snap.outcome_name,
        price,
        point,
        recordedAt: snap.recorded_at,
      });
    }

    const response: MovementResponse = {
      gameId: game.id,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      commenceTime: game.commence_time,
      marketType,
      openingLines,
      currentLines: Array.from(currentByKey.values()),
      priceHistory: Array.from(seriesByKey.values()),
      referenceOpens,
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[movement] Failed:", message);
    return NextResponse.json(emptyResponse(message), { status: 500 });
  }
}
