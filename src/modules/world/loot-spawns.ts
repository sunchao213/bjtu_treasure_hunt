import { CHEST_COUNTS, rollChestItem, type ChestTier } from '../../config/chest-config';
import { activeMap } from '../../config/play-map';
import type { Point, Rect } from '../../shared/types/game';
import { EVIDENCE_CAMPUS_MAP, questChapterById, QUEST_CHAPTER_ID } from '../quests/quest-service';
import { STORY_SITES } from './story-triggers';

export interface LootSpawn extends Point {
  id: string;
  itemId: string;
  zoneId: string;
  tier?: ChestTier;
}

/** The room round ID gives every member the same randomized campus layout. */
export function roundRandom(roundId: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < roundId.length; i++) seed = Math.imul(seed ^ roundId.charCodeAt(i), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Extra clearance leaves room to stand beside a chest and aim at it. */
const FOREGROUND_OCCLUSION_ZONES: readonly Rect[] = [
  // Red flag and pole in the west lawn.
  { x: 202, y: 610, width: 101, height: 280 },
  // Small sculpture ring, body and pedestal in the west lawn.
  { x: 218, y: 939, width: 85, height: 79 },
  { x: 220, y: 1018, width: 83, height: 32 },
  { x: 232, y: 1040, width: 58, height: 112 },
  { x: 204, y: 1142, width: 130, height: 50 },
];

export function clearLootPosition(
  p: Point,
  radius = 35,
  avoidForegroundOcclusion = false,
): boolean {
  const map = activeMap();
  const obstacles =
    avoidForegroundOcclusion && map.imageKey === 'campus-base'
      ? [...map.obstacles, ...FOREGROUND_OCCLUSION_ZONES]
      : map.obstacles;
  return (
    (!map.canSpawn || map.canSpawn(p)) &&
    p.x >= 30 + radius &&
    p.x <= map.width - 30 - radius &&
    p.y >= 35 + radius &&
    p.y <= map.height - 35 - radius &&
    !obstacles.some(
      (w) =>
        p.x + radius > w.x &&
        p.x - radius < w.x + w.width &&
        p.y + radius > w.y &&
        p.y - radius < w.y + w.height,
    )
  );
}

/** 任务证据刷新计划：每个章节的两件证据各占一个区域的固定搜索点。 */
export interface QuestSpawnPlan {
  itemId: string;
  zoneId: string;
  index: number;
  fixedPoint?: Point & { id: string };
}

export function questSpawnPlan(chapterId: string | null = QUEST_CHAPTER_ID): QuestSpawnPlan[] {
  if (chapterId === null) return [];
  const chapter = questChapterById(chapterId);
  const plan: QuestSpawnPlan[] = chapter.evidence
    .filter((entry) => entry.spawnZoneId !== '')
    .map((entry) => ({
      itemId: entry.itemId,
      zoneId: entry.spawnZoneId,
      index: entry.spawnIndex,
    }));
  if (chapter.id === 'siyuan-key') {
    plan[0] = {
      itemId: EVIDENCE_CAMPUS_MAP,
      zoneId: activeMap().chapterTwoPoints!.campusMap.zoneId,
      index: -1,
      fixedPoint: activeMap().chapterTwoPoints!.campusMap,
    };
    plan[1] = {
      itemId: 'siyuan-key',
      zoneId: activeMap().chapterTwoPoints!.siyuanKey.zoneId,
      index: -1,
      fixedPoint: activeMap().chapterTwoPoints!.siyuanKey,
    };
  }
  if (chapter.id === 'soothe-monster') {
    // The charm is earned by calming the authored garden encounter.
    return [
      {
        itemId: 'complete-record',
        zoneId: 'central-lawn',
        index: -1,
        fixedPoint: activeMap().chapterThreePoints!.record,
      },
    ];
  }
  // 第一章的手记来自思源楼前固定宝箱，不占用随机搜索区。
  if (chapter.id === QUEST_CHAPTER_ID) {
    plan.push({ itemId: 'torn-notebook', zoneId: 'siyuan', index: -1 });
  }
  return plan;
}

/** Finite candidate sampling: even a constant RNG cannot hang the raid. */
export function generateLootSpawns(
  random: () => number = Math.random,
  plan: readonly QuestSpawnPlan[] = questSpawnPlan(),
): LootSpawn[] {
  const result: LootSpawn[] = [];
  const randomSpawns: LootSpawn[] = [];
  const roll = () => Math.max(0, Math.min(0.999999, random()));
  const fixedQuestPoints = plan.filter((quest) => quest.fixedPoint);
  const map = activeMap();
  // Reserve every chapter's authored landmarks before sampling any random
  // chest. Room members may be on different chapters but share one layout.
  const reserved = [
    ...STORY_SITES,
    ...(map.questChest ? [map.questChest] : []),
    ...(map.chapterTwoPoints ? Object.values(map.chapterTwoPoints) : []),
    ...fixedQuestPoints.map((quest) => quest.fixedPoint!),
  ];
  for (let i = 0; i < fixedQuestPoints.length; i++) {
    const quest = fixedQuestPoints[i]!;
    const point = quest.fixedPoint!;
    const questChest = activeMap().questChest;
    if (
      !clearLootPosition(point) ||
      (questChest !== null && Math.hypot(point.x - questChest.x, point.y - questChest.y) < 90)
    ) {
      throw new Error(`Invalid fixed quest position for ${quest.itemId}`);
    }
    for (let j = 0; j < i; j++) {
      const other = fixedQuestPoints[j]!.fixedPoint!;
      if (Math.hypot(point.x - other.x, point.y - other.y) < 90) {
        throw new Error(`Overlapping fixed quest positions for ${quest.itemId}`);
      }
    }
    result.push({
      ...point,
      itemId: quest.itemId,
      zoneId: quest.zoneId,
    });
  }
  const questChest = activeMap().questChest;
  for (const zone of activeMap().lootZones) {
    const candidates: Point[] = [];
    for (let x = zone.x + 25; x < zone.x + zone.width - 20; x += 50) {
      for (let y = zone.y + 25; y < zone.y + zone.height - 20; y += 50) {
        if (
          clearLootPosition({ x, y }, 35, true) &&
          reserved.every((other) => Math.hypot(x - other.x, y - other.y) >= 90) &&
          (questChest === null || Math.hypot(x - questChest.x, y - questChest.y) >= 90) &&
          result.every((other) => Math.hypot(x - other.x, y - other.y) >= 90)
        ) {
          candidates.push({ x, y });
        }
      }
    }
    const quota = zone.id === 'lake' ? 1 : 3;
    // Shuffle a finite list, then backtrack if a central choice would crowd out
    // the remaining boxes. A unlucky first choice must not break raid startup.
    const available = candidates.filter((p) =>
      [...reserved, ...result].every((other) => Math.hypot(p.x - other.x, p.y - other.y) >= 120),
    );
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(roll() * (i + 1));
      [available[i], available[j]] = [available[j]!, available[i]!];
    }
    const choose = (pool: Point[], count: number): Point[] | null => {
      if (count === 0) return [];
      for (let i = 0; i < pool.length; i++) {
        const point = pool[i]!;
        const rest = choose(
          pool
            .slice(i + 1)
            .filter((other) => Math.hypot(point.x - other.x, point.y - other.y) >= 120),
          count - 1,
        );
        if (rest) return [point, ...rest];
      }
      return null;
    };
    const selected = choose(available, quota);
    if (!selected) throw new Error(`No accessible loot positions in ${zone.id}`);
    for (let i = 0; i < quota; i++) {
      const point = selected[i]!;
      const jitter = { x: point.x + (roll() - 0.5) * 20, y: point.y + (roll() - 0.5) * 20 };
      const position =
        clearLootPosition(jitter, 35, true) &&
        reserved.every((other) => Math.hypot(jitter.x - other.x, jitter.y - other.y) >= 90) &&
        result.every((other) => Math.hypot(jitter.x - other.x, jitter.y - other.y) >= 90)
          ? jitter
          : point;
      const quest = plan.find(
        (entry) => !entry.fixedPoint && entry.zoneId === zone.id && entry.index === i,
      );
      const rolledItemId = rollChestItem('normal', roll);
      const itemId = quest ? quest.itemId : rolledItemId;
      const spawn = { ...position, id: `${zone.id}-${i}`, itemId, zoneId: zone.id };
      result.push(spawn);
      // Authored quest slots never enter the tier-upgrade pool.
      if (!quest) randomSpawns.push(spawn);
    }
  }
  const selectedSpawns = new Set(assignChestTiers(randomSpawns, roll));
  const randomCandidates = new Set(randomSpawns);
  if (plan.some((entry) => entry.itemId === 'torn-notebook') && questChest) {
    result.push({ ...questChest, itemId: 'torn-notebook' });
  }
  return result.filter((point) => !randomCandidates.has(point) || selectedSpawns.has(point));
}

/** Select each round's random slots and tiers independently of authored evidence.
 * Intermediate chests occupy four randomly chosen exploration zones; normal
 * chests are sampled from the remaining candidates. All positions were sampled above. */
function assignChestTiers(points: LootSpawn[], random: () => number): LootSpawn[] {
  const shuffled = <T>(values: readonly T[]): T[] => {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  };
  const map = activeMap();
  const slots = points;
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const patrols = map.enemyRoutes
    .filter((route) => route.kind === 'patrol')
    .flatMap((route) => route.route);
  const exits = map.extractions.map((zone) => ({
    x: zone.x + zone.width / 2,
    y: zone.y + zone.height / 2,
  }));
  const deep = slots.filter(
    (point) =>
      slots.filter((other) => other.zoneId === point.zoneId).length > 1 &&
      distance(point, map.spawn) >= 900 &&
      exits.every((exit) => distance(point, exit) >= 700),
  );
  const guarded = deep.filter((point) => patrols.some((patrol) => distance(point, patrol) <= 300));
  const advancedPool = guarded.length ? guarded : deep;
  const advanced = advancedPool[Math.floor(random() * advancedPool.length)];
  if (!advanced) throw new Error('No accessible advanced chest position');
  advanced.tier = 'advanced';
  const selected = [advanced];
  const nearZone = [...map.lootZones].sort(
    (a, b) =>
      distance({ x: a.x + a.width / 2, y: a.y + a.height / 2 }, map.spawn) -
      distance({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, map.spawn),
  )[0];
  const mediumZones = shuffled(map.lootZones.filter((zone) => zone !== nearZone));
  for (const zone of mediumZones.slice(0, CHEST_COUNTS.intermediate)) {
    const candidates = slots.filter((point) => point.zoneId === zone.id && point !== advanced);
    if (!candidates.length) continue;
    const point = candidates[Math.floor(random() * candidates.length)]!;
    point.tier = 'intermediate';
    selected.push(point);
  }
  const normal = shuffled(slots.filter((point) => !selected.includes(point))).slice(
    0,
    CHEST_COUNTS.normal,
  );
  for (const point of normal) point.tier = 'normal';
  selected.push(...normal);
  if (selected.length !== CHEST_COUNTS.normal + CHEST_COUNTS.intermediate + CHEST_COUNTS.advanced) {
    throw new Error('Insufficient accessible chest positions');
  }
  for (const point of selected) {
    point.tier ??= 'normal';
    const itemId = point.tier === 'normal' ? point.itemId : rollChestItem(point.tier, random);
    point.itemId = itemId;
  }
  return selected;
}
