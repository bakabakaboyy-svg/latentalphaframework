import { NextResponse } from "next/server";
import { buildSignalEmbed, sendDiscordAlert } from "@/lib/signals/discord";
import { isSimulatedMode } from "@/lib/adapters/pinnacleAdapter";
import { prioritizeUrgent } from "@/lib/signals/velocity";
import type { SignalOpportunity } from "@/types/signals";

const STARTING_BANKROLL = Number(process.env.STARTING_BANKROLL ?? 10000);

// A fully-formed, believable sample opportunity — every field populated, all
// 5 models present for both sharp books — purely for verifying the embed's
// formatting renders correctly in a real Discord channel. Bypasses
// shouldAlert()'s dedup/threshold logic entirely since this is an explicit,
// on-demand trigger, not part of the automatic per-cycle detection flow.
function buildSampleOpportunity(): SignalOpportunity {
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(); // 6h out
  return {
    id: 0,
    gameId: 0,
    canonicalId: "0",
    sport: "MLB",
    marketType: "h2h",
    homeTeam: "Sample Home Team",
    awayTeam: "Sample Away Team",
    outcomeName: "Sample Away Team",
    side: "yes",
    executionVenue: "kalshi",
    offeredPrice: 0.58,
    consensusProb: 0.6289,
    perModelBreakdown: {
      pinnacle: { multiplicative: 0.631, additive: 0.629, power: 0.634, probit: 0.632, shin: 0.629 },
      circa: { multiplicative: 0.627, additive: 0.626, power: 0.63, probit: 0.628, shin: 0.626 },
    },
    worstCaseUsed: { pinnacle: 0.629, circa: 0.626 },
    evPercent: 0.084,
    kellyStakeDollars: 235,
    expectedProfit: 19.74,
    projectedIrr: 8.5,
    isSimulated: isSimulatedMode(),
    detectedAt: new Date().toISOString(),
    expiresAt,
    isUrgent: prioritizeUrgent(expiresAt),
  };
}

// POST /api/signals/alert — sends exactly one sample embed so the user can
// verify formatting in a real Discord channel, separate from the automatic
// alerts fired per detection cycle.
export async function POST() {
  const mode = isSimulatedMode() ? "SIMULATED" : "LIVE";
  const embed = buildSignalEmbed(buildSampleOpportunity(), mode, STARTING_BANKROLL);
  const sent = await sendDiscordAlert(embed);

  if (!sent) {
    return NextResponse.json(
      { success: false, error: "DISCORD_WEBHOOK_URL is not set, or Discord rejected the request — check server logs." },
      { status: 502 }
    );
  }
  return NextResponse.json({ success: true, mode });
}
