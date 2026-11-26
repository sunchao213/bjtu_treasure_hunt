import type { ItemInstance, RaidResult } from '../types/game';

export interface GameEvents {
  InventoryChanged: { readonly raidId: string };
  ItemPicked: { readonly raidId: string; readonly item: ItemInstance };
  SteleInvestigated: { readonly raidId: string };
  StoryDiscovered: {
    readonly raidId: string;
    readonly locationId: string;
    readonly chapterId: string;
    readonly title: string;
    readonly text: string;
  };
  ItemConsumed: {
    readonly raidId: string;
    readonly instanceId: string;
    readonly itemId: string;
  };
  ShieldAbsorbed: {
    readonly raidId: string;
    readonly amount: number;
    readonly remaining: number;
  };
  DamageTaken: { readonly raidId: string; readonly amount: number; readonly health: number };
  EnemyDefeated: { readonly raidId: string; readonly enemyId: string };
  LocationInteracted: { readonly raidId: string; readonly locationId: string };
  ExtractionStarted: { readonly raidId: string };
  RaidEnded: RaidResult;
}

/** Each subscriber owns its unsubscribe callback. Scene teardown must call it. */
export class EventBus {
  private readonly listeners = new Map<keyof GameEvents, Set<(payload: unknown) => void>>();

  on<K extends keyof GameEvents>(event: K, listener: (payload: GameEvents[K]) => void): () => void {
    const listeners = this.listeners.get(event) ?? new Set();
    const wrapped = (payload: unknown) => listener(payload as GameEvents[K]);
    listeners.add(wrapped);
    this.listeners.set(event, listeners);
    return () => {
      listeners.delete(wrapped);
    };
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(payload);
    }
  }
}
