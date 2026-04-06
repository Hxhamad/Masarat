import { useState, useEffect } from 'react';
import { useFlightStore } from '../stores/flightStore';
import type { TrailPoint } from '../types/flight';

const TRAIL_POLL_INTERVAL = 4_000; // 4 s

export function useSelectedFlightTrail(): TrailPoint[] {
  const selectedFlight = useFlightStore((s) => s.selectedFlight);
  const [trail, setTrail] = useState<TrailPoint[]>([]);

  useEffect(() => {
    if (!selectedFlight) {
      setTrail([]);
      return;
    }

    let cancelled = false;

    async function fetchTrail() {
      try {
        const res = await fetch(`/api/flights/${selectedFlight}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.trail)) {
          setTrail(data.trail);
        }
      } catch {
        // ignore
      }
    }

    void fetchTrail();
    const timer = setInterval(() => void fetchTrail(), TRAIL_POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedFlight]);

  return trail;
}
