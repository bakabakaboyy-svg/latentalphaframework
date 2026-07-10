import { NextRequest, NextResponse } from "next/server";
import { runScrape } from "@/lib/runScrape";

// POST /api/scrape/manual — same as /api/scrape but callable without
// CRON_SECRET, so the dashboard's Refresh button (and you, via curl, while
// developing) can trigger a scrape without needing to know a server secret.
//
// This is a publicly reachable POST endpoint on a deployed app, so in
// production we require the request to look like it came from our own page
// (Sec-Fetch-Site: same-origin — a header browsers set automatically and
// page JS cannot override) instead of leaving it open to anyone who finds
// the URL. Locally, in dev, this check is skipped so curl keeps working the
// same way it does against /api/scrape.
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite !== "same-origin") {
      return NextResponse.json(
        { success: false, error: "This endpoint can only be called from the LAF dashboard itself." },
        { status: 403 }
      );
    }
  }

  const result = await runScrape();
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
