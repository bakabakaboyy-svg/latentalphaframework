import { NextRequest, NextResponse } from "next/server";
import { runScrape } from "@/lib/runScrape";

// POST /api/scrape — protected endpoint called every 5 minutes by the GitHub
// Actions workflow at .github/workflows/scrape-cron.yml (originally planned
// as a Railway cron job, which was never actually deployed — production went
// ~7 hours without a fresh scrape before this was wired up). For manual/dev
// testing without the secret, use POST /api/scrape/manual instead.
//
// Test manually with:
//   curl -X POST http://localhost:3000/api/scrape -H "x-cron-secret: <your CRON_SECRET>"
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = request.headers.get("x-cron-secret");

  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET is not configured on the server." },
      { status: 500 }
    );
  }

  if (providedSecret !== cronSecret) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const result = await runScrape();
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
