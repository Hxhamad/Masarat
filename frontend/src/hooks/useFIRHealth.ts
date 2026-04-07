import { useEffect, useCallback } from 'react';
import { useHealthStore } from '../stores/healthStore';
import { useFIRStore } from '../stores/firStore';
import { useFilterStore } from '../stores/filterStore';
import type { FIRHealthSummary, FIRHealthSnapshot, LeaderboardEntry } from '../types/health';

const HEALTH_POLL_MS = 30_000; // 30s refresh

export function useFIRHealth() {
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const aircraftScope = useFilterStore((s) => s.aircraftScope);
  const viewMode = useHealthStore((s) => s.viewMode);
  const {
    setHealthData,
    setHistoryData,
    setLeaderboard,
    setHealthLoading,
    setLeaderboardLoading,
    setError,
  } = useHealthStore();

  const fetchHealth = useCallback(async (signal?: AbortSignal) => {
    if (aircraftScope === 'all' || selectedFIRs.length === 0) return;
    setHealthLoading(true);
    setError(null);

    try {
      // Fetch health for each selected FIR in parallel
      const results = await Promise.all(
        selectedFIRs.map(async (firId) => {
          const res = await fetch(`/api/fir/${encodeURIComponent(firId)}/health`, signal ? { signal } : undefined);
          if (!res.ok) throw new Error(`Health fetch failed for ${firId}`);
          return (await res.json()) as FIRHealthSummary;
        })
      );
      if (signal?.aborted) return;
      for (const r of results) {
        setHealthData(r.firId, r);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      if (!signal?.aborted) setHealthLoading(false);
    }
  }, [aircraftScope, selectedFIRs, setHealthData, setHealthLoading, setError]);

  const fetchHistory = useCallback(async (firId: string, signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/fir/${encodeURIComponent(firId)}/history?hours=24`, signal ? { signal } : undefined);
      if (!res.ok) return;
      const data = await res.json();
      if (signal?.aborted) return;
      setHistoryData(firId, (data.history ?? []) as FIRHealthSnapshot[]);
    } catch {
      // Silent fail for history (includes AbortError)
    }
  }, [setHistoryData]);

  const fetchLeaderboard = useCallback(async (signal?: AbortSignal) => {
    if (aircraftScope === 'all') return;
    setLeaderboardLoading(true);
    try {
      const ids = selectedFIRs.join(',');
      const res = await fetch(`/api/fir/leaderboard${ids ? `?firIds=${ids}` : ''}`, signal ? { signal } : undefined);
      if (!res.ok) throw new Error('Leaderboard fetch failed');
      const data = await res.json();
      if (signal?.aborted) return;
      setLeaderboard((data.leaderboard ?? []) as LeaderboardEntry[]);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      if (!signal?.aborted) setLeaderboardLoading(false);
    }
  }, [aircraftScope, selectedFIRs, setLeaderboard, setLeaderboardLoading, setError]);

  // Poll health when in health or leaderboard view
  useEffect(() => {
    if (viewMode === 'flights' || aircraftScope === 'all') {
      setHealthLoading(false);
      setLeaderboardLoading(false);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    // Initial fetch
    if (viewMode === 'health') {
      fetchHealth(signal);
      // Also fetch history for first selected FIR
      if (selectedFIRs[0]) fetchHistory(selectedFIRs[0], signal);
    } else if (viewMode === 'leaderboard') {
      fetchLeaderboard(signal);
    }

    // Periodic refresh
    const timer = setInterval(() => {
      if (viewMode === 'health') fetchHealth(signal);
      else if (viewMode === 'leaderboard') fetchLeaderboard(signal);
    }, HEALTH_POLL_MS);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [aircraftScope, viewMode, selectedFIRs, fetchHealth, fetchHistory, fetchLeaderboard, setHealthLoading, setLeaderboardLoading]);

  return { fetchHealth, fetchHistory, fetchLeaderboard };
}
