"use client";

import { useCallback, useEffect, useState } from "react";
import type { GameWithOdds, LogBetResponse, MarketType, OddsResponse } from "@/types/odds";
import { MARKETS, type SportFilter } from "./filters";
import type { ToastVariant } from "./Toast";

function logError(context: string, err: unknown) {
  console.error(`[BetEntryForm ${new Date().toISOString()}] ${context}:`, err);
}

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function formatGameOption(game: GameWithOdds): string {
  const time = new Date(game.commenceTime).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${game.awayTeam} @ ${game.homeTeam} (${time})`;
}

function formatOutcomeLabel(marketType: MarketType, outcomeName: string, point: number | null): string {
  if (marketType === "h2h") return `${outcomeName} to Win`;
  if (marketType === "totals") return `${outcomeName} ${point ?? ""}`.trim();
  // spreads
  const pointLabel = point !== null ? (point > 0 ? `+${point}` : `${point}`) : "";
  return `${outcomeName} ${pointLabel}`.trim();
}

function outcomeKeyOf(outcomeName: string, point: number | null): string {
  return `${outcomeName}|${point ?? "null"}`;
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getDefaultEntryTimeValue(): string {
  return toDatetimeLocalValue(new Date());
}

export function BetEntryForm({
  sport,
  showToast,
  onBetLogged,
}: {
  sport: SportFilter;
  showToast: (message: string, variant?: ToastVariant) => void;
  onBetLogged: () => void;
}) {
  const [formMarket, setFormMarket] = useState<MarketType>("h2h");
  const [games, setGames] = useState<GameWithOdds[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);

  const [selectedGameId, setSelectedGameId] = useState<number | "">("");
  const [selectedOutcomeKey, setSelectedOutcomeKey] = useState("");
  const [selectedBookSlug, setSelectedBookSlug] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [stake, setStake] = useState("");
  const [entryTime, setEntryTime] = useState(getDefaultEntryTimeValue);
  const [submitting, setSubmitting] = useState(false);

  const fetchGames = useCallback(async () => {
    setGamesLoading(true);
    try {
      const params = new URLSearchParams({ market_type: formMarket });
      if (sport !== "all") params.set("sport", sport);
      const res = await fetch(`/api/odds?${params.toString()}`);
      const json: OddsResponse = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load games");
      setGames(json.games);
    } catch (err) {
      logError("fetchGames failed", err);
      showToast("Failed to load games for the bet form.", "error");
    } finally {
      setGamesLoading(false);
    }
  }, [sport, formMarket, showToast]);

  useEffect(() => {
    const timeoutId = setTimeout(fetchGames, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchGames]);

  // Selections downstream of a changed field are no longer valid — reset them.
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setSelectedGameId("");
      setSelectedOutcomeKey("");
      setSelectedBookSlug("");
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [sport, formMarket]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setSelectedOutcomeKey("");
      setSelectedBookSlug("");
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [selectedGameId]);

  useEffect(() => {
    const timeoutId = setTimeout(() => setSelectedBookSlug(""), 0);
    return () => clearTimeout(timeoutId);
  }, [selectedOutcomeKey]);

  const selectedGame = games.find((g) => g.id === selectedGameId) ?? null;

  const outcomeOptions = selectedGame
    ? Array.from(new Map(selectedGame.odds.map((o) => [outcomeKeyOf(o.outcomeName, o.point), o])).values())
    : [];

  const bookOptions = selectedGame
    ? selectedGame.odds.filter((o) => outcomeKeyOf(o.outcomeName, o.point) === selectedOutcomeKey)
    : [];

  const selectedOutcome = outcomeOptions.find((o) => outcomeKeyOf(o.outcomeName, o.point) === selectedOutcomeKey);

  // Plain (non-memoized) handler — it's only ever used inline as this form's
  // onSubmit, never passed to a memoized child, so it doesn't need useCallback.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const priceNum = Number(entryPrice);
    if (!selectedGameId || !selectedOutcomeKey || !selectedBookSlug || !entryPrice || Number.isNaN(priceNum)) {
      showToast("All fields required", "error");
      return;
    }
    if (!selectedGame || !selectedOutcome) {
      showToast("All fields required", "error");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/clv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: selectedGame.id,
          marketType: formMarket,
          outcomeName: selectedOutcome.outcomeName,
          point: selectedOutcome.point,
          bookSlug: selectedBookSlug,
          entryPrice: priceNum,
          stake: stake ? Number(stake) : null,
          entryTime: entryTime ? new Date(entryTime).toISOString() : null,
        }),
      });
      const json: LogBetResponse = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to log bet");

      const bookName = bookOptions.find((b) => b.bookSlug === selectedBookSlug)?.bookName ?? selectedBookSlug;
      showToast(
        `Bet logged! Tracking CLV for ${selectedOutcome.outcomeName} ${formatPrice(priceNum)} at ${bookName}`,
        "success"
      );

      setSelectedGameId("");
      setSelectedOutcomeKey("");
      setSelectedBookSlug("");
      setEntryPrice("");
      setStake("");
      setEntryTime(getDefaultEntryTimeValue());
      onBetLogged();
    } catch (err) {
      logError("submit failed", err);
      showToast(err instanceof Error ? err.message : "Failed to log bet", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-surface p-4 flex flex-col gap-4"
    >
      <div className="text-sm font-semibold">LOG A BET</div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted">Game</label>
        {gamesLoading ? (
          <div className="skeleton rounded-md h-9 w-full" />
        ) : (
          <select
            value={selectedGameId}
            onChange={(e) => setSelectedGameId(e.target.value ? Number(e.target.value) : "")}
            required
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent"
          >
            <option value="">Select a game...</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {formatGameOption(g)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted">Market type</label>
        <div className="flex gap-3">
          {MARKETS.map((m) => (
            <label key={m.slug} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
              <input
                type="radio"
                name="marketType"
                value={m.slug}
                checked={formMarket === m.slug}
                onChange={() => setFormMarket(m.slug)}
                className="accent-[#22c55e]"
              />
              {m.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted">Outcome</label>
        <select
          value={selectedOutcomeKey}
          onChange={(e) => setSelectedOutcomeKey(e.target.value)}
          required
          disabled={!selectedGame}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="">{selectedGame ? "Select an outcome..." : "Select a game first"}</option>
          {outcomeOptions.map((o) => (
            <option key={outcomeKeyOf(o.outcomeName, o.point)} value={outcomeKeyOf(o.outcomeName, o.point)}>
              {formatOutcomeLabel(formMarket, o.outcomeName, o.point)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted">Book</label>
        <select
          value={selectedBookSlug}
          onChange={(e) => setSelectedBookSlug(e.target.value)}
          required
          disabled={!selectedOutcomeKey}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="">{selectedOutcomeKey ? "Select a book..." : "Select an outcome first"}</option>
          {bookOptions.map((b) => (
            <option key={b.bookSlug} value={b.bookSlug}>
              {b.bookName} ({formatPrice(b.price)})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Entry price</label>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            placeholder="-110"
            required
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Stake (optional)</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            placeholder="100"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted">Entry time</label>
        <input
          type="datetime-local"
          value={entryTime}
          onChange={(e) => setEntryTime(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-accent"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-accent text-background font-semibold text-sm py-2.5 hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {submitting ? "LOGGING..." : "LOG BET"}
      </button>
    </form>
  );
}
