import type { ItemInstance, RaidResult } from '../../shared/types/game';

/**
 * D 的任务模块：本局任务前置判定、临时进度与章节解锁判定。
 *
 * 边界（与 docs/handoff.md 一致）：
 * - 一切判定基于调用方传入的「权威携带物快照」，不维护第二份物品副本；
 * - 只认 origin = raid-loot 且 obtainedInRaidId = 本局 raidId 的证据，带入物与上一局物品无效；
 * - 本模块不写任何永久数据：章节解锁的落库仍由 SavePort.finalizeRaid 完成，
 *   chapterUnlockGranted() 与存档层保持同一套规则，仅供结果展示使用。
 */

export const QUEST_CHAPTER_ID = 'siyuan-code';
export const SECOND_CHAPTER_ID = 'siyuan-key';
export const THIRD_CHAPTER_ID = 'soothe-monster';

export const EVIDENCE_NOTEBOOK = 'torn-notebook';
export const EVIDENCE_FEATHER = 'anomalous-feather';
export const EVIDENCE_CAMPUS_MAP = 'campus-map';
export const EVIDENCE_SIYUAN_KEY = 'siyuan-key';
export const EVIDENCE_SOOTHE_CHARM = 'soothe-charm';
export const EVIDENCE_COMPLETE_RECORD = 'complete-record';

/** 单件任务证据的展示与搜索指引。 */
export interface QuestEvidenceSpec {
  readonly itemId: string;
  /** 失败 / 未解锁提示里使用的物品名（带书名号）。 */
  readonly label: string;
  /** 任务卡「线索 X · 去……用手电寻找……」的方位指引。 */
  readonly searchHint: string;
  /** 大厅目标清单上的短地点名（如「图书馆外」）。 */
  readonly placeName: string;
  /** 运行时刷新点：WORLD.lootZones 的 id。 */
  readonly spawnZoneId: string;
  /** 该区域里的第几个搜索点（0 起）。 */
  readonly spawnIndex: number;
}

/** 一章任务的证据组合与文案；文案口径见剧情稿 v1.1 表 7。 */
export interface QuestChapterSpec {
  readonly id: string;
  /** 章节序号（1 起），用于大厅「01 / 02 / 03」编号。 */
  readonly order: number;
  readonly title: string;
  /** 两件证据：先拿第一件，第二件需要本局持有第一件。 */
  readonly evidence: readonly [QuestEvidenceSpec, QuestEvidenceSpec];
  /** 第二件证据缺少前置时的拦截提示。 */
  readonly prerequisiteHint: string;
  /** 两件齐备后的引导文案。 */
  readonly completeHint: string;
}

export const QUEST_CHAPTERS: readonly QuestChapterSpec[] = [
  {
    id: QUEST_CHAPTER_ID,
    order: 1,
    title: '第一章 · 思源楼的残缺手记',
    evidence: [
      {
        itemId: EVIDENCE_NOTEBOOK,
        label: '「残缺手记」',
        searchHint: '去思源楼前打开固定宝箱，取得残缺手记',
        placeName: '思源楼前',
        spawnZoneId: '',
        spawnIndex: -1,
      },
      {
        itemId: 'minghu-stele',
        label: '「明湖石碑调查记录」',
        searchHint: '前往明湖石碑附近按 E 调查',
        placeName: '明湖石碑',
        spawnZoneId: '',
        spawnIndex: -1,
      },
    ],
    prerequisiteHint: '明湖石碑：先在思源楼前取得本局残缺手记。',
    completeHint: '任务完成：携带本局残缺手记成功撤离可解锁第一章。',
  },
  {
    id: SECOND_CHAPTER_ID,
    order: 2,
    title: '第二章 · 失效的思源钥匙',
    evidence: [
      {
        itemId: EVIDENCE_CAMPUS_MAP,
        label: '「被涂改的校园地图」',
        searchHint: '去中央教学楼下方的公告栏，调查被涂改的校园地图',
        placeName: '中央教学楼公告栏',
        spawnZoneId: 'central-lawn',
        spawnIndex: 0,
      },
      {
        itemId: EVIDENCE_SIYUAN_KEY,
        label: '「思源楼金钥匙」',
        searchHint: '去思源楼东侧道路，调查思源楼金钥匙',
        placeName: '思源楼东侧道路',
        spawnZoneId: 'library',
        spawnIndex: 0,
      },
    ],
    prerequisiteHint: '侧门线索：缺少本局被涂改的校园地图。',
    completeHint: '线索齐备：带回南门撤离可解锁第二章。',
  },
  {
    id: THIRD_CHAPTER_ID,
    order: 3,
    title: '第三章 · 被抱住的怪物',
    evidence: [
      {
        itemId: EVIDENCE_SOOTHE_CHARM,
        label: '「安抚护符」',
        searchHint: '去芳华园，用手电寻找安抚护符',
        placeName: '芳华园',
        spawnZoneId: 'east-garden',
        spawnIndex: 0,
      },
      {
        itemId: EVIDENCE_COMPLETE_RECORD,
        label: '「完整记录」',
        searchHint: '去中心广场，用手电寻找完整记录',
        placeName: '中心广场',
        spawnZoneId: 'central-lawn',
        spawnIndex: 0,
      },
    ],
    prerequisiteHint: '记录线索：缺少本局安抚护符。',
    completeHint: '线索齐备：带回南门撤离可解锁第三章。',
  },
];

// 第一章文案常量保持原口径，供现有界面与测试直接引用。
export const QUEST_COMPLETE_HINT = QUEST_CHAPTERS[0]!.completeHint;
export const NOTEBOOK_PREREQUISITE_HINT = QUEST_CHAPTERS[0]!.prerequisiteHint;

export function questChapterById(chapterId: string): QuestChapterSpec {
  return QUEST_CHAPTERS.find((chapter) => chapter.id === chapterId) ?? QUEST_CHAPTERS[0]!;
}

/** 某件证据属于哪一章（拾取时用来决定弹哪一章的剧情）。 */
export function questChapterForEvidence(itemId: string): string {
  const owner = QUEST_CHAPTERS.find((chapter) =>
    chapter.evidence.some((entry) => entry.itemId === itemId),
  );
  return (owner ?? QUEST_CHAPTERS[0]!).id;
}

/**
 * 当前进行中的章节：第一个尚未解锁的章节；三章全通时停在第三章（已解锁，不再重复发奖）。
 * 大厅只展示「已解锁章节」与「当前章节」，所以这就是玩家下一步要打的那一关。
 */
export function activeQuestChapter(unlockedChapterIds: readonly string[]): QuestChapterSpec {
  const next = QUEST_CHAPTERS.find((chapter) => !unlockedChapterIds.includes(chapter.id));
  return next ?? QUEST_CHAPTERS[QUEST_CHAPTERS.length - 1]!;
}

/** 大厅里应当展示的章节：已解锁的全部 + 当前进行中的那一章。 */
export function visibleQuestChapters(
  unlockedChapterIds: readonly string[],
): readonly QuestChapterSpec[] {
  const active = activeQuestChapter(unlockedChapterIds);
  return QUEST_CHAPTERS.filter(
    (chapter) => chapter.order <= active.order || unlockedChapterIds.includes(chapter.id),
  );
}

export interface CarriedEvidence {
  readonly notebook: boolean;
  readonly feather: boolean;
  readonly collected: number;
}

/** 章节证据统计：本局新获得且仍携带的证据。 */
export interface ChapterEvidence {
  readonly chapterId: string;
  readonly evidenceIds: readonly string[];
  readonly carriedIds: readonly string[];
  readonly collected: number;
  readonly total: number;
  readonly complete: boolean;
}

export interface QuestProgressView extends CarriedEvidence {
  readonly chapterId: string;
  readonly evidenceIds: readonly string[];
  readonly carriedIds: readonly string[];
  readonly collected: number;
  readonly total: number;
  readonly complete: boolean;
  readonly statusText: string;
  readonly steleInvestigated: boolean;
}

function hasEvidence(
  items: readonly ItemInstance[],
  evidenceId: string,
  raidId: string | null,
): boolean {
  return (
    raidId !== null &&
    items.some(
      (item) =>
        item.itemId === evidenceId &&
        item.origin.kind === 'raid-loot' &&
        item.origin.obtainedInRaidId === raidId,
    )
  );
}

/** 从权威快照中统计指定章节「本局新获得且仍携带」的任务证据。 */
export function chapterEvidence(
  items: readonly ItemInstance[],
  raidId: string | null,
  chapterId: string = QUEST_CHAPTER_ID,
  steleInvestigated = false,
): ChapterEvidence {
  const chapter = questChapterById(chapterId);
  const evidenceIds = chapter.evidence.map((entry) => entry.itemId);
  const carriedIds = evidenceIds.filter((itemId) =>
    itemId === 'minghu-stele' ? steleInvestigated : hasEvidence(items, itemId, raidId),
  );
  return {
    chapterId: chapter.id,
    evidenceIds,
    carriedIds,
    collected: carriedIds.length,
    total: 2,
    complete: carriedIds.length === 2,
  };
}

/** 第一章证据的兼容视图（既有界面与测试按 notebook / feather 字段读取）。 */
export function carriedEvidence(
  items: readonly ItemInstance[],
  raidId: string | null,
): CarriedEvidence {
  const notebook = hasEvidence(items, EVIDENCE_NOTEBOOK, raidId);
  const feather = false;
  return { notebook, feather, collected: notebook ? 1 : 0 };
}

/** 兼容旧调用方：只认本局新获得且仍携带的手记。 */
export function hasCurrentRaidNotebook(
  items: readonly ItemInstance[],
  raidId: string | null,
): boolean {
  return hasEvidence(items, EVIDENCE_NOTEBOOK, raidId);
}

/**
 * 地点调查前置：目标搜索点需要前置证据时返回拦截提示文案；返回 null 表示允许调查。
 * 每章的第二件证据都必须先持有本局的第一件证据。
 */
export function prerequisiteHint(
  chestItemId: string,
  items: readonly ItemInstance[],
  raidId: string | null,
  chapterId: string = QUEST_CHAPTER_ID,
): string | null {
  const chapter = questChapterById(chapterId);
  const [, second] = chapter.evidence;
  if (chestItemId !== second.itemId) {
    return null;
  }
  const first = chapter.evidence[0].itemId;
  return hasEvidence(items, first, raidId) ? null : chapter.prerequisiteHint;
}

/** 本局任务是否已凑齐（临时进度，不落永久档）。 */
export function isQuestComplete(
  items: readonly ItemInstance[],
  raidId: string | null,
  chapterOrStele: string | boolean = QUEST_CHAPTER_ID,
  steleInvestigated = false,
): boolean {
  const chapterId = typeof chapterOrStele === 'string' ? chapterOrStele : QUEST_CHAPTER_ID;
  const stele = typeof chapterOrStele === 'boolean' ? chapterOrStele : steleInvestigated;
  return chapterEvidence(items, raidId, chapterId, stele).complete;
}

/** 任务卡的展示数据（含中文状态文案）。 */
export function questProgress(
  items: readonly ItemInstance[],
  raidId: string | null,
  chapterOrStele: string | boolean = QUEST_CHAPTER_ID,
  steleInvestigated = false,
): QuestProgressView {
  const chapterId = typeof chapterOrStele === 'string' ? chapterOrStele : QUEST_CHAPTER_ID;
  const stele = typeof chapterOrStele === 'boolean' ? chapterOrStele : steleInvestigated;
  const chapter = questChapterById(chapterId);
  const evidence = chapterEvidence(items, raidId, chapter.id, stele);
  const firstCarried = evidence.carriedIds.includes(chapter.evidence[0].itemId);
  let statusText: string;
  if (raidId === null) {
    statusText = '开始探索后，可按线索搜集任务证据。';
  } else if (evidence.complete) {
    statusText = chapter.completeHint;
  } else if (chapter.id === QUEST_CHAPTER_ID && stele && !firstCarried) {
    statusText = chapter.prerequisiteHint;
  } else if (firstCarried) {
    statusText = `线索二 · ${chapter.evidence[1].searchHint}`;
  } else {
    statusText = `线索一 · ${chapter.evidence[0].searchHint}`;
  }
  return {
    ...carriedEvidence(items, raidId),
    chapterId: chapter.id,
    evidenceIds: evidence.evidenceIds,
    carriedIds: evidence.carriedIds,
    collected: evidence.collected,
    total: evidence.total,
    complete: evidence.complete,
    steleInvestigated: stele,
    statusText,
  };
}

/**
 * 结算侧判定：与 SavePort.finalizeRaid 的解锁规则一致——
 * 成功撤离 + questComplete + 本章两件证据均为本局 raid-loot。仅供结果展示，不做任何写入。
 */
export function chapterUnlockGranted(
  result: RaidResult,
  chapterId: string = QUEST_CHAPTER_ID,
): boolean {
  if (result.outcome !== 'success' || result.questComplete !== true) {
    return false;
  }
  const chapter = questChapterById(chapterId);
  if (chapterId === QUEST_CHAPTER_ID) {
    return hasEvidence(result.items, EVIDENCE_NOTEBOOK, result.raidId);
  }
  return chapter.evidence.every((entry) => hasEvidence(result.items, entry.itemId, result.raidId));
}
