import type { HtnosEvent } from '@htn/shared';

export type EventListener = (event: HtnosEvent) => void;

export class EventHub {
  private readonly listeners = new Map<string, Set<EventListener>>();

  subscribe(badgeId: string, listener: EventListener): () => void {
    const listeners = this.listeners.get(badgeId) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(badgeId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(badgeId);
    };
  }

  publish(badgeId: string, event: HtnosEvent): void {
    for (const listener of this.listeners.get(badgeId) ?? []) listener(event);
  }
}
