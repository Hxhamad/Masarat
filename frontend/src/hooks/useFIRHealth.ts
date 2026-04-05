import { useEffect, useRef, useCallback } from 'react';
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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    if (aircraftScope === 'all' || selectedFIRs.length === 0) return;
    setHealthLoading(true);
    setError(null);

    try {
      // Fetch health for each selected FIR in parallel
      const results = await Promise.all(
        selectedFIRs.map(async (firId) => {
          const res = await fetch(`/api/fir/${encodeURIComponent(firId)}/health`);
          if (!res.ok) throw new Error(`Health fetch failed for ${firId}`);
          return (await res.json()) as FIRHealthSummary;
        })
      );
      for (const r of results) {
        setHealthData(r.firId, r);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setHealthLoading(false);
    }
  }, [aircraftScope, selectedFIRs, setHealthData, setHealthLoading, setError]);

  const fetchHistory = useCallback(async (firId: string) => {
    try {
      const res = await fetch(`/api/fir/${encodeURIComponent(firId)}/history?hours=24`);
      if (!res.ok) return;
      const data = await res.json();
      setHistoryData(firId, (data.history ?? []) as FIRHealthSnapshot[]);
    } catch {
      // Silent fail for history
    }
  }, [setHistoryData]);

  const fetchLeaderboard = useCallback(async () => {
    if (aircraftScope === 'all') return;
    setLeaderboardLoading(true);
    try {
      const ids = selectedFIRs.join(',');
      const res = await fetch(`/api/fir/leaderboard${ids ? `?firIds=${ids}` : ''}`);
      if (!res.ok) throw new Error('Leaderboard fetch failed');
      const data = await res.json();
      setLeaderboard((data.leaderboard ?? []) as LeaderboardEntry[]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [aircraftScope, selectedFIRs, setLeaderboard, setLeaderboardLoading, setError]);

  // Poll health when in health or leaderboard view
  useEffect(() => {
    if (viewMode === 'flights' || aircraftScope === 'all') {
      if (timerRef.current) clearInterval(timerRef.current);
      setHealthLoading(false);
      setLeaderboardLoading(false);
      return;
    }

    // Initial fetch
    if (viewMode === 'health') {
      fetchHealth();
      // Also fetch history for first selected FIR
      if (selectedFIRs[0]) fetchHistory(selectedFIRs[0]);
    } else if (viewMode === 'leaderboard') {
      fetchLeaderboard();
    }

    // Periodic refresh
    timerRef.current = setInterval(() => {
      if (viewMode === 'health') fetchHealth();
      else if (viewMode === 'leaderboard') fetchLeaderboard();
    }, HEALTH_POLL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [aircraftScope, viewMode, selectedFIRs, fetchHealth, fetchHistory, fetchLeaderboard, setHealthLoading, setLeaderboardLoading]);

  return { fetchHealth, fetchHistory, fetchLeaderboard };
}
