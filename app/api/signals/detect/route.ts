import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runSignalsDetection } from "@/lib/signals/detect";
import type { DetectSignalsResponse } from "@/types/signals";

// POST /api/signals/detect — runs one detection pass across WNBA/MLB h2h
// markets and upserts (inserts, historical-log style — see detect.ts)
// results into signal_opportunities. Also called directly, in-process, by
// lib/runScrape.ts on every real 5-minute GitHub Actions scrape cycle; this
// route exists for on-demand triggering and manual verification.
export async function POST() {
  try {
    const supabase = getSupabaseAdmin();
    const result = await runSignalsDetection(supabase);
    return NextResponse.json(result satisfies DetectSignalsResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[signals/detect] Failed:", message);
    return NextResponse.json({ opportunitiesFound: 0, simulated: true, topEv: null, error: message } satisfies DetectSignalsResponse, {
      status: 500,
    });
  }
}
