/** Shared chest presentation, search time and independent per-item loot weights. */
export type ChestTier = 'normal' | 'intermediate' | 'advanced';

export const CHEST_COUNTS = { normal: 6, intermediate: 4, advanced: 1 } as const;

export const CHEST_TIERS = {
  normal: { name: '普通宝箱', durationMs: 2_000, texture: 'treasure-chest', color: 0xf4d17d },
  intermediate: {
    name: '中级宝箱',
    durationMs: 4_000,
    texture: 'treasure-chest-intermediate',
    color: 0x78baff,
  },
  advanced: {
    name: '高级宝箱',
    durationMs: 6_000,
    texture: 'treasure-chest-advanced',
    color: 0xcf8aff,
  },
} as const;

const CHEST_LOOT: Record<ChestTier, readonly { itemId: string; weight: number }[]> = {
  normal: [
    { itemId: 'window-seat', weight: 0.3 },
    { itemId: 'morning-coffee', weight: 0.3 },
    { itemId: 'school-badge', weight: 0.3 },
    { itemId: 'roller-skates', weight: 0.08 },
    { itemId: 'hunter-binoculars', weight: 0.018 },
    { itemId: 'strange-veined-ginkgo-leaf', weight: 0.002 },
  ],
  intermediate: [
    { itemId: 'window-seat', weight: 0.4 / 3 },
    { itemId: 'morning-coffee', weight: 0.4 / 3 },
    { itemId: 'school-badge', weight: 0.4 / 3 },
    { itemId: 'gpa-charm', weight: 0.58 / 3 },
    { itemId: 'library-reward-ticket', weight: 0.58 / 3 },
    { itemId: 'hunter-binoculars', weight: 0.58 / 3 },
    { itemId: 'silver-watch', weight: 0.01 },
    { itemId: 'strange-veined-ginkgo-leaf', weight: 0.01 },
  ],
  advanced: [
    { itemId: 'hunter-binoculars', weight: 0.45 },
    { itemId: 'david-head-statue', weight: 0.45 },
    { itemId: 'silver-watch', weight: 0.05 },
    { itemId: 'strange-veined-ginkgo-leaf', weight: 0.05 },
  ],
};

export function rollChestItem(tier: ChestTier, random: () => number): string {
  const pool = CHEST_LOOT[tier];
  let remaining = Math.max(0, Math.min(0.999999999, random()));
  for (const entry of pool) {
    remaining -= entry.weight;
    if (remaining < 0) return entry.itemId;
  }
  return pool[pool.length - 1]!.itemId;
}
