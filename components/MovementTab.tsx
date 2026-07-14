"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameWithOdds, MarketType, MovementResponse, OddsResponse } from "@/types/odds";
import { SportMarketFilters, type SportFilter } from "./filters";
import { OpeningLineChart } from "./OpeningLineChart";
import { PriceHistoryChart } from "./PriceHistoryChart";
import { MovementTable } from "./MovementTable";

const MARKET_LABELS: Record<MarketType, string> = { h2h: "MONEYLINE", spreads: "SPREAD", totals: "TOTAL" };

function logError(context: string, err: unknown) {
  console.error(`[MovementTab ${new Date().toISOString()}] ${context}:`, err);
}

function formatGameHeader(homeTeam: string, awayTeam: string, commenceTime: string): string {
  const time = new Date(commenceTime).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${homeTeam} @ ${awayTeam} — ${time}`;
}

function formatDropdownOption(game: GameWithOdds): string {
  const time = new Date(game.commenceTime).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${game.awayTeam} @ ${game.homeTeam} — ${time}`;
}

export function MovementTab({
  sport,
  market,
  onSportChange,
  onMarketChange,
}: {
  sport: SportFilter;
  market: MarketType;
  onSportChange: (sport: SportFilter) => void;
  onMarketChange: (market: MarketType) => void;
}) {
  const [games, setGames] = useState<GameWithOdds[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<number | "">("");

  const [movement, setMovement] = useState<MovementResponse | null>(null);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);

  const fetchGames = useCallback(async () => {
    setGamesLoading(true);
    setGamesError(null);
    try {
      const params = new URLSearchParams({ market_type: market });
      if (sport !== "all") params.set("sport", sport);
      const res = await fetch(`/api/odds?${params.toString()}`);
      const data: OddsResponse = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load games");
      setGames(data.games);
    } catch (err) {
      logError("fetchGames failed", err);
      setGamesError("Failed to load games. Please try again.");
    } finally {
      setGamesLoading(false);
    }
  }, [sport, market]);

  useEffect(() => {
    const timeoutId = setTimeout(fetchGames, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchGames]);

  // The previously selected game may not exist in a new sport/market's game
  // list, so clear the selection (and any stale chart data) whenever filters change.
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setSelectedGameId("");
      setMovement(null);
      setMovementError(null);
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [sport, market]);

  const fetchMovement = useCallback(
    async (gameId: number) => {
      setMovementLoading(true);
      setMovementError(null);
      try {
        const params = new URLSearchParams({ game_id: String(gameId), market_type: market });
        const res = await fetch(`/api/movement?${params.toString()}`);
        const data: MovementResponse = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load movement data");
        setMovement(data);
      } catch (err) {
        logError("fetchMovement failed", err);
        setMovementError("Failed to load movement data. Please try again.");
        setMovement(null);
      } finally {
        setMovementLoading(false);
      }
    },
    [market]
  );

  const handleSelectGame = (value: string) => {
    if (!value) {
      setSelectedGameId("");
      setMovement(null);
      return;
    }
    const gameId = Number(value);
    setSelectedGameId(gameId);
    fetchMovement(gameId);
  };

  const selectedGameMeta = useMemo(() => games.find((g) => g.id === selectedGameId) ?? null, [games, selectedGameId]);

  return (
    <div className="flex flex-col gap-4">
      <SportMarketFilters sport={sport} market={market} onSportChange={onSportChange} onMarketChange={onMarketChange} />

      {gamesError && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{gamesError}</div>
      )}

      {gamesLoading ? (
        <div className="skeleton rounded-md h-10 w-full max-w-md" />
      ) : (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Select a game to view detailed movement</label>
          <select
            value={selectedGameId}
            onChange={(e) => handleSelectGame(e.target.value)}
            className="max-w-md rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent"
          >
            <option value="">(Select a game...)</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {formatDropdownOption(g)}
              </option>
            ))}
          </select>
        </div>
      )}

      {!gamesLoading && !gamesError && games.length === 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          No games found for {sport === "all" ? "ALL sports" : sport.toUpperCase()} {MARKET_LABELS[market]}.
        </div>
      )}

      {selectedGameId !== "" && (
        <>
          {movementError && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{movementError}</div>
          )}

          {movementLoading && (
            <div className="flex flex-col gap-4">
              <div className="skeleton rounded-md h-56 w-full" />
              <div className="skeleton rounded-md h-56 w-full" />
              <div className="skeleton rounded-md h-40 w-full" />
            </div>
          )}

          {!movementLoading && movement && selectedGameMeta && (
            <div className="fade-in-row flex flex-col gap-6">
              <div>
                <div className="text-sm font-medium">
                  {formatGameHeader(movement.homeTeam, movement.awayTeam, movement.commenceTime)}
                </div>
                <div className="text-xs font-mono text-muted mt-1">
                  {MARKET_LABELS[market]} ·{" "}
                  {movement.referenceOpens.length > 0
                    ? movement.referenceOpens
                        .map(
                          (ref) =>
                            `Opened: ${ref.outcomeName} ${ref.price > 0 ? "+" : ""}${ref.price}${
                              ref.point !== null ? ` (${ref.point > 0 ? "+" : ""}${ref.point})` : ""
                            } (${ref.bookName})`
                        )
                        .join(" · ")
                    : "No opening line recorded yet"}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface p-4">
                <div className="text-xs font-mono uppercase text-muted mb-3">Opening line comparison</div>
                <OpeningLineChart openingLines={movement.openingLines} />
              </div>

              <div className="rounded-lg border border-border bg-surface p-4">
                <div className="text-xs font-mono uppercase text-muted mb-3">Price history over time</div>
                <PriceHistoryChart priceHistory={movement.priceHistory} />
              </div>

              <div>
                <div className="text-xs font-mono uppercase text-muted mb-3">Line movement details</div>
                <MovementTable openingLines={movement.openingLines} currentLines={movement.currentLines} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
