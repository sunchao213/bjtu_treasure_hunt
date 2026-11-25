import campus from '../../config/formal-campus.json';
import type { ItemInstance, Point } from '../../shared/types/game';
import { hasEvidence, questChapterById } from '../quests/quest-service';

export type StoryTriggerKind = 'chest' | 'stele' | 'board' | 'door' | 'help' | 'record' | 'exit';
export interface StoryTrigger extends Point {
  id: string;
  kind: StoryTriggerKind;
  title: string;
  action: string;
  chapterId: string;
  status: 'active' | 'locked' | 'done' | 'inactive';
}
/** Approach scenes give a visible landmark a narrative response before its interaction. */
export const STORY_APPROACHES: Readonly<Record<string, string>> = {
  'siyuan-notebook-chest':
    '思源楼前的路灯忽明忽暗。一只落满灰尘的宝箱出现在台阶旁，箱盖下露出被水浸过的纸页。停下脚步，用手电照着宝箱，长按 E 搜索。',
  'minghu-stele':
    '湖风掠过写着「明湖」的石碑。碑身背面有一道浅刻痕，与手记上的记号重合。停下来按 E，试着让石头把未说完的话说完。',
  'campus-map-point':
    '教学区的公告栏上，一张校园地图被反复描粗。那些发亮的线条绕开正门，延伸到思源楼东侧。按 E 取下地图。',
  'siyuan-key-point':
    '你沿着被涂改的地图来到思源楼东侧。这里没有钥匙孔，只有一块吞掉反光的金属牌。按 E，把路线与门牌上的刻痕对照。',
  'complete-record-point':
    '中心广场的记录台泛起微光，护符也在掌心变暖。按 E，将护符贴近记录台，读出被遗漏的那一页。',
  'south-extraction-point':
    '两件证据都还在背包里。南门的灯在前方亮着——携带价值达到 100 后，按 E 开始撤离，并留在区域内等待 5 秒。',
};
export const STORY_SITES = [
  {
    ...campus.questChest,
    kind: 'chest',
    title: '思源楼前 · 手记宝箱',
    action: '长按 E 搜索手记',
    chapterId: 'siyuan-code',
  },
  {
    ...campus.stone,
    id: 'minghu-stele',
    kind: 'stele',
    title: '明湖石碑',
    action: '按 E 调查石碑',
    chapterId: 'siyuan-code',
  },
  {
    ...campus.chapterTwoPoints.campusMap,
    kind: 'board',
    title: '教学区 · 校园公告栏',
    action: '按 E 调查地图',
    chapterId: 'siyuan-key',
  },
  {
    ...campus.chapterTwoPoints.siyuanKey,
    kind: 'door',
    title: '思源楼东侧 · 记录侧门',
    action: '按 E 对照路线调查侧门',
    chapterId: 'siyuan-key',
  },
  {
    ...campus.chapterThreePoints.help,
    kind: 'help',
    title: '芳华园 · 求助信号',
    action: '靠近求助者，停住长按 Q 安抚',
    chapterId: 'soothe-monster',
  },
  {
    ...campus.chapterThreePoints.record,
    kind: 'record',
    title: '中心广场 · 记录台',
    action: '按 E 对应护符，读取记录',
    chapterId: 'soothe-monster',
  },
] as const;

export function storyTriggers(
  chapterId: string | null,
  items: readonly ItemInstance[],
  raidId: string | null,
): StoryTrigger[] {
  if (chapterId === null) return [];
  const chapter = questChapterById(chapterId);
  const first = hasEvidence(items, chapter.evidence[0].itemId, raidId);
  const second = hasEvidence(items, chapter.evidence[1].itemId, raidId);
  const sites = STORY_SITES.filter((site) => site.chapterId === chapterId);
  const result: StoryTrigger[] = STORY_SITES.map((site) => ({
    ...site,
    status:
      site.chapterId !== chapterId
        ? 'inactive'
        : site.id === sites[0]?.id
          ? first
            ? 'done'
            : 'active'
          : second
            ? 'done'
            : first
              ? 'active'
              : 'locked',
  }));
  result.push({
    ...campus.spawn,
    id: 'south-extraction-point',
    kind: 'exit',
    title: '南门 · 带证据撤离',
    action: '携带价值达到 100 后按 E 撤离',
    chapterId,
    status: first && second ? 'active' : 'locked',
  });
  return result;
}

export function storyDirection(from: Point, to: Point): string {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 85) return '就在附近';
  const directions = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'];
  return `校园${directions[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8]}侧`;
}
