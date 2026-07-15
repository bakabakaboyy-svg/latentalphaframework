import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { calculateClvPercentage } from "@/lib/utils/clv";
import type {
  BetEntry,
  BetStatus,
  CLVResponse,
  LogBetRequest,
  LogBetResponse,
  MarketType,
  UpdateBetRequest,
  UpdateBetResponse,
} from "@/types/odds";

// GET /api/clv?status=open&sport=mlb&market_type=h2h
// Returns bet_entries matching the filters. For "open" bets, currentPrice and
// clvPercentage are computed live against the latest matching odds_snapshot
// (not stored) — for "closed"/"graded" bets, the stored closing_price and
// clv_percentage (set once, by PUT, at close time) are returned as-is.
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const status = (searchParams.get("status") ?? "open") as BetStatus;
    const sportSlug = searchParams.get("sport");
    const marketType = searchParams.get("market_type") as MarketType | null;

    let gamesQuery = supabase
      .from("bet_entries")
      .select(
        "id, game_id, book_id, market_type, outcome_name, point, entry_price, stake, entry_time, closing_price, clv_percentage, status, games(home_team, away_team, sport_id, sports(slug)), books(slug, name)"
      )
      .eq("status", status)
      .order("entry_time", { ascending: false });

    if (marketType) gamesQuery = gamesQuery.eq("market_type", marketType);

    const { data: rows, error: rowsError } = await gamesQuery;
    if (rowsError) throw new Error(`Failed to load bet_entries: ${rowsError.message}`);

    let filteredRows = rows ?? [];
    if (sportSlug) {
      filteredRows = filteredRows.filter((row) => {
        const sport = (row.games as unknown as { sports: { slug: string } | null } | null)?.sports;
        return sport?.slug === sportSlug;
      });
    }

    // For open bets, look up the latest odds_snapshot per (game, book,
    // market, outcome, point) touched by any of these bets, in one batch
    // query rather than one per bet.
    const openGameIds = Array.from(
      new Set(filteredRows.filter((r) => r.status === "open").map((r) => r.game_id).filter((id): id is number => id !== null))
    );

    const latestPriceByKey = new Map<string, number>();
    if (openGameIds.length > 0) {
      const { data: snapshots, error: snapshotsError } = await supabase
        .from("odds_snapshots")
        .select("game_id, book_id, market_type, outcome_name, point, price, recorded_at")
        .in("game_id", openGameIds)
        .order("recorded_at", { ascending: false });
      if (snapshotsError) throw new Error(`Failed to load odds_snapshots: ${snapshotsError.message}`);

      // Rows arrive newest-first, so the first one seen per key is current.
      for (const snap of snapshots ?? []) {
        const key = `${snap.game_id}|${snap.book_id}|${snap.market_type}|${snap.outcome_name}|${snap.point ?? "null"}`;
        if (!latestPriceByKey.has(key)) latestPriceByKey.set(key, Number(snap.price));
      }
    }

    const bets: BetEntry[] = filteredRows.map((row) => {
      const game = row.games as unknown as { home_team: string; away_team: string } | null;
      const book = row.books as unknown as { slug: string; name: string } | null;
      const entryPrice = Number(row.entry_price);
      const point = row.point === null ? null : Number(row.point);

      let currentPrice: number | null = null;
      let clvPercentage: number | null = row.clv_percentage === null ? null : Number(row.clv_percentage);

      if (row.status === "open") {
        const key = `${row.game_id}|${row.book_id}|${row.market_type}|${row.outcome_name}|${row.point ?? "null"}`;
        const price = latestPriceByKey.get(key);
        if (price !== undefined) {
          currentPrice = price;
          clvPercentage = calculateClvPercentage(entryPrice, price);
        }
      }

      return {
        id: row.id,
        gameId: row.game_id,
        homeTeam: game?.home_team ?? "",
        awayTeam: game?.away_team ?? "",
        marketType: row.market_type as MarketType,
        outcomeName: row.outcome_name,
        point,
        bookSlug: book?.slug ?? "",
        bookName: book?.name ?? "",
        entryPrice,
        currentPrice,
        stake: row.stake === null ? null : Number(row.stake),
        entryTime: row.entry_time,
        closingPrice: row.closing_price === null ? null : Number(row.closing_price),
        clvPercentage,
        status: row.status as BetStatus,
      };
    });

    return NextResponse.json({ bets } satisfies CLVResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[clv] GET failed:", message);
    return NextResponse.json({ bets: [], error: message } satisfies CLVResponse, { status: 500 });
  }
}

// POST /api/clv — log a new bet.
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = (await request.json()) as LogBetRequest;

    if (
      !body.gameId ||
      !body.marketType ||
      !body.outcomeName ||
      !body.bookSlug ||
      typeof body.entryPrice !== "number" ||
      Number.isNaN(body.entryPrice)
    ) {
      return NextResponse.json(
        { success: false, error: "All fields required" } satisfies LogBetResponse,
        { status: 400 }
      );
    }

    const { data: book, error: bookError } = await supabase
      .from("books")
      .select("id")
      .eq("slug", body.bookSlug)
      .single();
    if (bookError || !book) {
      return NextResponse.json(
        { success: false, error: `Unknown book: ${body.bookSlug}` } satisfies LogBetResponse,
        { status: 400 }
      );
    }

    const insertRow = {
      game_id: body.gameId,
      book_id: book.id,
      market_type: body.marketType,
      outcome_name: body.outcomeName,
      point: body.point,
      entry_price: body.entryPrice,
      stake: body.stake,
      ...(body.entryTime ? { entry_time: body.entryTime } : {}),
    };

    const { data: inserted, error: insertError } = await supabase
      .from("bet_entries")
      .insert(insertRow)
      .select("id")
      .single();
    if (insertError || !inserted) {
      throw new Error(`Failed to insert bet_entries: ${insertError?.message ?? "unknown error"}`);
    }

    // Best-effort live CLV for the immediate response (not stored — see the
    // GET handler for how open-bet CLV is computed on every fetch instead).
    let clvPercentage: number | null = null;
    const { data: latestSnap } = await supabase
      .from("odds_snapshots")
      .select("price")
      .eq("game_id", body.gameId)
      .eq("book_id", book.id)
      .eq("market_type", body.marketType)
      .eq("outcome_name", body.outcomeName)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestSnap) clvPercentage = calculateClvPercentage(body.entryPrice, Number(latestSnap.price));

    return NextResponse.json({ success: true, betId: inserted.id, clvPercentage } satisfies LogBetResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[clv] POST failed:", message);
    return NextResponse.json({ success: false, error: message } satisfies LogBetResponse, { status: 500 });
  }
}

// PUT /api/clv — mark a bet closed/graded. finalClvPercentage is always
// computed server-side from entry_price + closingPrice, not trusted from the
// client.
export async function PUT(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = (await request.json()) as UpdateBetRequest;

    if (!body.betId || !body.status || typeof body.closingPrice !== "number" || Number.isNaN(body.closingPrice)) {
      return NextResponse.json(
        { success: false, error: "betId, status, and closingPrice are required" } satisfies UpdateBetResponse,
        { status: 400 }
      );
    }

    const { data: existing, error: fetchError } = await supabase
      .from("bet_entries")
      .select("entry_price")
      .eq("id", body.betId)
      .single();
    if (fetchError || !existing) {
      return NextResponse.json(
        { success: false, error: `Bet ${body.betId} not found` } satisfies UpdateBetResponse,
        { status: 404 }
      );
    }

    const finalClvPercentage = calculateClvPercentage(Number(existing.entry_price), body.closingPrice);

    const { error: updateError } = await supabase
      .from("bet_entries")
      .update({ status: body.status, closing_price: body.closingPrice, clv_percentage: finalClvPercentage })
      .eq("id", body.betId);
    if (updateError) throw new Error(`Failed to update bet_entries: ${updateError.message}`);

    return NextResponse.json({ success: true, finalClvPercentage } satisfies UpdateBetResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[clv] PUT failed:", message);
    return NextResponse.json({ success: false, error: message } satisfies UpdateBetResponse, { status: 500 });
  }
}
