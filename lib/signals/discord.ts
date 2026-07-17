// Discord alerting for SIGNALS opportunities. Posts directly to a webhook
// URL (no bot framework) — same architectural choice already made for
// quant_engine's own Discord alerting this session (webhooks are send-only,
// no gateway connection needed for one-way notifications).
import type { SignalMode, SignalOpportunity } from "@/types/signals";

const COLOR_AMBER = 0xf59e0b; // matches LAF's own --warning design token
const COLOR_GREEN = 0x22c55e; // matches LAF's own --accent design token

interface DiscordEmbed {
  title: string;
  color: number;
  description?: string;
  fields: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

function formatBreakdownField(bookName: string, opp: SignalOpportunity): { name: string; value: string } {
  const breakdown = opp.perModelBreakdown[bookName];
  const worstCase = opp.worstCaseUsed[bookName];
  const lines = (Object.entries(breakdown) as [string, number][]).map(([model, prob]) => {
    const isWorstCase = Math.abs(prob - worstCase) < 1e-9;
    return `${model.padEnd(14)} ${formatPct(prob)}${isWorstCase ? "  <- worst-case (used)" : ""}`;
  });
  return { name: bookName.toUpperCase(), value: `\`\`\`\n${lines.join("\n")}\n\`\`\`` };
}

// Every field the spec asks for: matchup, sport, settle time + urgency,
// strategy/side/venue, offered price, consensus prob, EV%, quarter-Kelly
// stake ($ and %), expected profit, projected IRR, and the full 5-model
// breakdown per sharp book with the worst-case cell flagged, plus the
// consensus average.
export function buildSignalEmbed(opp: SignalOpportunity, mode: SignalMode, bankroll: number): DiscordEmbed {
  const isSimulated = mode === "SIMULATED";
  const settleLabel = opp.expiresAt ? new Date(opp.expiresAt).toLocaleString() : "unknown";
  const urgencyLabel = opp.isUrgent ? " ⚠️ settling within 48h" : "";
  const kellyPct = bankroll > 0 ? opp.kellyStakeDollars / bankroll : 0;

  const fields: DiscordEmbed["fields"] = [
    { name: "Matchup", value: `${opp.awayTeam} @ ${opp.homeTeam}`, inline: false },
    { name: "Sport", value: opp.sport, inline: true },
    { name: "Settles", value: `${settleLabel}${urgencyLabel}`, inline: true },
    { name: "Strategy", value: `BUY ${opp.side.toUpperCase()} — ${opp.executionVenue.toUpperCase()}`, inline: false },
    { name: "Offered Price", value: opp.offeredPrice.toFixed(4), inline: true },
    { name: "Consensus Prob", value: formatPct(opp.consensusProb), inline: true },
    { name: "EV%", value: formatPct(opp.evPercent), inline: true },
    { name: "Kelly Stake", value: `$${opp.kellyStakeDollars.toFixed(0)} (${formatPct(kellyPct)} of $${bankroll.toLocaleString()})`, inline: true },
    { name: "Expected Profit", value: `$${opp.expectedProfit.toFixed(2)}`, inline: true },
    { name: "Projected IRR", value: `${formatPct(opp.projectedIrr)} (illustrative)`, inline: true },
  ];

  for (const bookName of Object.keys(opp.perModelBreakdown)) {
    fields.push(formatBreakdownField(bookName, opp));
  }
  fields.push({ name: "Consensus Average", value: formatPct(opp.consensusProb), inline: false });

  return {
    title: isSimulated ? "🧪 SIMULATED — NOT FOR EXECUTION" : "🟢 LIVE +EV OPPORTUNITY",
    color: isSimulated ? COLOR_AMBER : COLOR_GREEN,
    fields,
    footer: { text: `Opportunity #${opp.id}` },
  };
}

// Only send when this is genuinely new information: a first sighting, or an
// existing opportunity whose EV moved materially (>=1 percentage point) —
// avoids re-alerting the same near-identical opportunity every 5-minute
// scrape cycle.
export function shouldAlert(previousEv: number | null, newEv: number, thresholdEv: number): boolean {
  if (newEv < thresholdEv) return false;
  if (previousEv === null) return true;
  return Math.abs(newEv - previousEv) >= 0.01;
}

// Posts one embed to DISCORD_WEBHOOK_URL. If it's not configured, logs a
// warning and no-ops rather than throwing — alerting is a nice-to-have, not
// something that should ever break detection. Handles Discord 429s with one
// bounded retry (Discord's own retry_after, capped at 3s so a single alert
// can never meaningfully stall a scrape cycle) before giving up and logging.
export async function sendDiscordAlert(embed: DiscordEmbed): Promise<boolean> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn(`[signals/discord] DISCORD_WEBHOOK_URL not set — would have sent: ${embed.title}`);
    return false;
  }

  const post = () => fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });

  try {
    let res = await post();
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}) as { retry_after?: number });
      const retryAfterMs = Math.min(3000, Math.round((body.retry_after ?? 1) * 1000));
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      res = await post();
    }
    if (!res.ok) {
      console.error(`[signals/discord] Webhook returned ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[signals/discord] Failed to send alert:", err instanceof Error ? err.message : err);
    return false;
  }
}
