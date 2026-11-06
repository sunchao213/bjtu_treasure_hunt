import { WORLD } from '../../config/world-config';
import { questChapterById, QUEST_CHAPTER_ID } from '../quests/quest-service';
import type { Point } from '../../shared/types/game';

export interface LootSpawn extends Point {
  id: string;
  itemId: string;
  zoneId: string;
}

/** Extra clearance leaves room to stand beside a chest and aim at it. */
export function clearLootPosition(p: Point, radius = 35): boolean {
  return (
    p.x >= 30 + radius &&
    p.x <= WORLD.width - 30 - radius &&
    p.y >= 35 + radius &&
    p.y <= WORLD.height - 35 - radius &&
    !WORLD.obstacles.some(
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

export function questSpawnPlan(chapterId: string = QUEST_CHAPTER_ID): QuestSpawnPlan[] {
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
      itemId: 'campus-map',
      zoneId: WORLD.chapterTwoPoints.campusMap.zoneId,
      index: -1,
      fixedPoint: WORLD.chapterTwoPoints.campusMap,
    };
    plan[1] = {
      itemId: 'siyuan-key',
      zoneId: WORLD.chapterTwoPoints.siyuanKey.zoneId,
      index: -1,
      fixedPoint: WORLD.chapterTwoPoints.siyuanKey,
    };
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
  const roll = () => Math.max(0, Math.min(0.999999, random()));
  const fixedQuestPoints = plan.filter((quest) => quest.fixedPoint);
  for (let i = 0; i < fixedQuestPoints.length; i++) {
    const quest = fixedQuestPoints[i]!;
    const point = quest.fixedPoint!;
    if (
      !clearLootPosition(point) ||
      Math.hypot(point.x - WORLD.questChest.x, point.y - WORLD.questChest.y) < 90
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
  const questItemIds = new Set(plan.map((entry) => entry.itemId));
  for (const zone of WORLD.lootZones) {
    const candidates: Point[] = [];
    for (let x = zone.x + 25; x < zone.x + zone.width - 20; x += 50) {
      for (let y = zone.y + 25; y < zone.y + zone.height - 20; y += 50) {
        if (
          clearLootPosition({ x, y }) &&
          Math.hypot(x - WORLD.questChest.x, y - WORLD.questChest.y) >= 90 &&
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
      result.every((other) => Math.hypot(p.x - other.x, p.y - other.y) >= 120),
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
      const pool = ['window-seat', 'morning-coffee', 'school-badge'];
      const quest = plan.find(
        (entry) => !entry.fixedPoint && entry.zoneId === zone.id && entry.index === i,
      );
      const availablePool = pool.filter((candidate) => !questItemIds.has(candidate));
      const itemId = quest
        ? quest.itemId
        : availablePool[Math.floor(roll() * availablePool.length)]!;
      result.push({ ...point, id: `${zone.id}-${i}`, itemId, zoneId: zone.id });
    }
  }
  if (plan.some((entry) => entry.itemId === 'torn-notebook')) {
    result.push({ ...WORLD.questChest, itemId: 'torn-notebook' });
  }
  return result;
}
