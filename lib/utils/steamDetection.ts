import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_TIME_WINDOW_MINUTES = 5;
const MIN_BOOKS_FOR_STEAM = 3;

export interface DetectedSteamMove {
  game_id: number;
  market_type: string;
  outcome_name: string;
  direction: "up" | "down";
  trigger_book: string;
  price_before: number;
  price_after: number;
  books_moved: number; // books OTHER than trigger_book that followed it
  detected_at: string;
}

interface BookPoint {
  price: number;
  recordedAt: string;
  bookName: string;
  isSharp: boolean;
}

interface OutcomeDelta {
  bookName: string;
  isSharp: boolean;
  delta: number;
  latestPrice: number;
  prevPrice: number;
}

// Detects steam moves — 3+ books' prices moving the same direction within
// `timeWindowMinutes` — by comparing each book's two most recent
// odds_snapshots for every (game, market, outcome) among the given games.
//
// NOTE on "trigger book": our sources hand us a periodic snapshot of every
// book at once (not a real-time feed), so if several books changed within
// the same scrape we genuinely can't tell which moved first. We prefer a
// sharp book if one moved, else the book with the largest price change, as a
// reasonable display choice — not a detected timing signal (same caveat as
// opening_lines.first_recorded_book from Session 3).
export async function detectSteamMoves(
  supabase: SupabaseClient,
  gameIds: number[],
  scrapedAt: string,
  timeWindowMinutes: number = DEFAULT_TIME_WINDOW_MINUTES
): Promise<DetectedSteamMove[]> {
  if (gameIds.length === 0) return [];

  // Look back further than the window so we can find each book's *previous*
  // snapshot even when scrapes aren't running exactly every timeWindowMinutes.
  const lookbackMinutes = Math.max(timeWindowMinutes * 6, 60);
  const cutoff = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();

  const { data: snapshots, error } = await supabase
    .from("odds_snapshots")
    .select("game_id, market_type, outcome_name, price, recorded_at, books(name, is_sharp)")
    .in("game_id", gameIds)
    .gte("recorded_at", cutoff)
    .order("recorded_at", { ascending: false });

  if (error) throw new Error(`Failed to load snapshots for steam detection: ${error.message}`);

  // Keep the latest 2 snapshots per (game, market, outcome, book) — rows
  // arrive newest-first, so the first two we see per key are what we want.
  const byBookGroup = new Map<string, BookPoint[]>();
  for (const snap of snapshots ?? []) {
    const book = snap.books as unknown as { name: string; is_sharp: boolean } | null;
    if (!book) continue;
    const key = JSON.stringify([snap.game_id, snap.market_type, snap.outcome_name, book.name]);
    const points = byBookGroup.get(key);
    const point: BookPoint = {
      price: Number(snap.price),
      recordedAt: snap.recorded_at,
      bookName: book.name,
      isSharp: book.is_sharp,
    };
    if (points) {
      if (points.length < 2) points.push(point);
    } else {
      byBookGroup.set(key, [point]);
    }
  }

  // For every book that moved within the time window, group its delta under
  // its (game, market, outcome).
  const deltasByOutcome = new Map<
    string,
    { gameId: number; marketType: string; outcomeName: string; deltas: OutcomeDelta[] }
  >();

  for (const [key, points] of byBookGroup) {
    if (points.length < 2) continue;
    const [latest, prev] = points;
    const gapMinutes = (new Date(latest.recordedAt).getTime() - new Date(prev.recordedAt).getTime()) / 60000;
    if (gapMinutes <= 0 || gapMinutes > timeWindowMinutes) continue;
    const delta = latest.price - prev.price;
    if (delta === 0) continue;

    const [gameId, marketType, outcomeName] = JSON.parse(key) as [number, string, string];
    const outcomeKey = JSON.stringify([gameId, marketType, outcomeName]);
    const entry = deltasByOutcome.get(outcomeKey) ?? { gameId, marketType, outcomeName, deltas: [] };
    entry.deltas.push({
      bookName: latest.bookName,
      isSharp: latest.isSharp,
      delta,
      latestPrice: latest.price,
      prevPrice: prev.price,
    });
    deltasByOutcome.set(outcomeKey, entry);
  }

  const steamMoves: DetectedSteamMove[] = [];

  for (const { gameId, marketType, outcomeName, deltas } of deltasByOutcome.values()) {
    const up = deltas.filter((d) => d.delta > 0);
    const down = deltas.filter((d) => d.delta < 0);
    const moved = up.length >= MIN_BOOKS_FOR_STEAM ? up : down.length >= MIN_BOOKS_FOR_STEAM ? down : null;
    if (!moved) continue;

    const direction: "up" | "down" = moved === up ? "up" : "down";

    const trigger = [...moved].sort((a, b) => {
      if (a.isSharp !== b.isSharp) return a.isSharp ? -1 : 1;
      return Math.abs(b.delta) - Math.abs(a.delta);
    })[0];

    steamMoves.push({
      game_id: gameId,
      market_type: marketType,
      outcome_name: outcomeName,
      direction,
      trigger_book: trigger.bookName,
      price_before: trigger.prevPrice,
      price_after: trigger.latestPrice,
      books_moved: moved.length - 1,
      detected_at: scrapedAt,
    });

    const arrow = direction === "up" ? "↗" : "↘";
    console.log(
      `[steam] ${arrow} STEAM: ${outcomeName} (${marketType}) moved ${direction} — trigger ${trigger.bookName} ${
        trigger.prevPrice > 0 ? "+" : ""
      }${trigger.prevPrice} -> ${trigger.latestPrice > 0 ? "+" : ""}${trigger.latestPrice}, ${
        moved.length - 1
      } other book(s) followed.`
    );
  }

  return steamMoves;
}
