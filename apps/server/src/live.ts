import type { LiveEvent } from '@htn/shared';

export type LiveListener = (event: LiveEvent) => void;

/**
 * In-process fan-out for SSE. One channel per pairing code; a hacker may have the
 * badge view open in more than one tab, so channels hold a set of listeners.
 *
 * Deliberately not durable: a dropped connection re-fetches the full badge view
 * on reconnect, so there is nothing worth replaying.
 */
export class LiveHub {
  private readonly channels = new Map<string, Set<LiveListener>>();

  subscribe(pairingCode: string, listener: LiveListener): () => void {
    let listeners = this.channels.get(pairingCode);
    if (!listeners) {
      listeners = new Set();
      this.channels.set(pairingCode, listeners);
    }
    listeners.add(listener);

    return () => {
      const current = this.channels.get(pairingCode);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.channels.delete(pairingCode);
    };
  }

  publish(pairingCode: string, event: LiveEvent): void {
    const listeners = this.channels.get(pairingCode);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        // A wedged client must never break the box request that triggered this.
        console.error('[live] listener failed', error);
      }
    }
  }

  listenerCount(pairingCode: string): number {
    return this.channels.get(pairingCode)?.size ?? 0;
  }

  clear(): void {
    this.channels.clear();
  }
}
