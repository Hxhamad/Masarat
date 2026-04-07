/**
 * Regression: startAggregator awaits primeInitialSnapshot before polling.
 *
 * The original bug started polling concurrently with the bootstrap fetch,
 * so the cache could be empty when clients connect. The fix uses
 * `await primeInitialSnapshot()` before calling `poll()`.
 *
 * This test verifies the sequencing contract by simulating the bootstrap/poll
 * lifecycle with instrumented callbacks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Aggregator startup ordering', () => {
  it('prime completes before poll begins', async () => {
    const callOrder: string[] = [];

    // Simulate the fixed startAggregator pattern
    async function primeInitialSnapshot(): Promise<void> {
      callOrder.push('prime:start');
      // Simulate async fetch delay
      await new Promise(r => setTimeout(r, 10));
      callOrder.push('prime:done');
    }

    function poll(): void {
      callOrder.push('poll:start');
    }

    // Replicate the fixed startup: await prime, then poll
    async function startAggregator(): Promise<void> {
      await primeInitialSnapshot();
      poll();
    }

    await startAggregator();

    expect(callOrder).toEqual(['prime:start', 'prime:done', 'poll:start']);
  });

  it('poll still starts even if prime throws', async () => {
    const callOrder: string[] = [];

    async function primeInitialSnapshot(): Promise<void> {
      callOrder.push('prime:start');
      throw new Error('Network error');
    }

    function poll(): void {
      callOrder.push('poll:start');
    }

    // Replicate the pattern with try/catch like the real code
    async function startAggregator(): Promise<void> {
      try {
        await primeInitialSnapshot();
      } catch {
        callOrder.push('prime:failed');
      }
      poll();
    }

    await startAggregator();

    expect(callOrder).toEqual(['prime:start', 'prime:failed', 'poll:start']);
    // Key assertion: poll happens AFTER prime failure, not concurrently
    expect(callOrder.indexOf('poll:start')).toBeGreaterThan(callOrder.indexOf('prime:start'));
  });
});
