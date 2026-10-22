import { EVIDENCE_FEATHER, EVIDENCE_NOTEBOOK, QUEST_CHAPTER_ID } from './quest-service';

/**
 * D 的剧情内容（与逻辑分离的纯数据，便于评审文案与后续扩章）。
 *
 * 术语口径与文档保持一致：一条「三步任务链」，每一步配一段剧情正文（stepBody）。
 * 不使用自创的幕/章节层级命名；世界观仅限虚构的校园异常，不指向真实校内事务。
 */

export interface ChapterStep {
  readonly stepId: string;
  /** 第几步（1 起），与任务链顺序一致。 */
  readonly stepNumber: number;
  /** 展示标题：线索一／线索二／线索三 + 短标题。 */
  readonly title: string;
  /** 与场景搜索点/撤离点对应的地点 ID，便于与地图配置对齐。 */
  readonly locationId: string;
  /** 回看该步所需的本局证据（用于未解锁时的条件说明）。 */
  readonly requiresEvidence: readonly string[];
  readonly stepBody: string;
}

export interface ChapterContent {
  readonly chapterId: string;
  readonly title: string;
  readonly subtitle: string;
  /** 进入该章解锁的条件说明（未解锁时展示）。 */
  readonly unlockHint: string;
  readonly steps: readonly ChapterStep[];
}

export const FIRST_CHAPTER: ChapterContent = {
  chapterId: QUEST_CHAPTER_ID,
  title: '第一章 · 明湖边的异常羽毛',
  subtitle: '海淀校区夜巡记录 / 调查员手记摘录',
  unlockHint: '携带残缺手记与异常羽毛并成功撤离后，可回看本章三段剧情。',
  steps: [
    {
      stepId: 'step-1-library-shelf',
      stepNumber: 1,
      title: '线索一 · 书架夹层里的半本旧册',
      locationId: 'library-outside-shelf',
      requiresEvidence: [],
      stepBody:
        '图书馆外的旧书架本该只剩毕业生留下的纸箱。你按夜巡手册的指引翻到第三层，指腹碰到一处比木板更硬的夹层。' +
        '抽出来的是半本残缺手记：封皮被水浸过，扉页却清清楚楚写着「思源」两个字，后面几页全被撕掉，' +
        '只剩一行铅笔小字——「水边有记号的石头，替我把话说完」。你把它塞进背包，天光又暗了一格。',
    },
    {
      stepId: 'step-2-minghu-stele',
      stepNumber: 2,
      title: '线索二 · 明湖石碑上的记号',
      locationId: 'minghu-stele',
      requiresEvidence: [EVIDENCE_NOTEBOOK],
      stepBody:
        '明湖的风比操场冷。石碑背面有一处浅得几乎看不见的刻痕，正是手记里那种「替我把话说完」的记号。' +
        '你照着笔画描了一遍，碑身轻轻震了一下，一枚泛着微光的异常羽毛落进掌心，轻得不像实物。' +
        '水面上浮起一圈不属于路灯的蓝光，随即熄灭。你意识到：这枚羽毛不能留在这里，它得被带出去。',
    },
    {
      stepId: 'step-3-south-extraction',
      stepNumber: 3,
      title: '线索三 · 带着证据走出异常区域',
      locationId: 'south-extraction-point',
      requiresEvidence: [EVIDENCE_NOTEBOOK, EVIDENCE_FEATHER],
      stepBody:
        '南门的撤离灯在雾里一亮一暗。你背着手记与羽毛往光里走，身后的校园安静得不正常——' +
        '路灯一盏盏熄灭，像是有人在你走后关掉了布景。' +
        '跨出边界的那一刻，口袋里的羽毛凉了下来，手记扉页的「思源」二字洇开成一行新字：' +
        '「第一段记录已回收。下一段，等你自己找到地点。」',
    },
  ],
};

/** 图鉴条目描述：所有可入仓物品都有对应说明。 */
export const CODEX_ENTRIES: Readonly<Record<string, string>> = {
  'scratch-paper': '写满公式又划掉的草稿纸，边角还留着自习室的桌号。',
  'half-eraser': '用到只剩半块的橡皮，擦得最干净的一角写着「别放弃」。',
  'campus-map': '手绘的校园地图，几处角落被反复描粗——像是有人不想被忘记。',
  'portable-medkit': '随身恢复包，第一节课后就一直躺在书包侧袋里。',
  'torn-notebook': '被水浸过的半本手记，扉页只剩「思源」二字。',
  'window-seat': '靠窗座凭证：图书馆二楼西侧那排座位，冬天下午最暖的位置。',
  'morning-coffee': '早八不困咖啡，热气挡不住困意，但能让人撑过前三节。',
  'school-badge': '校训徽章，别在包带上，走夜路时反着光。',
  'anomalous-feather': '明湖石碑给的异常羽毛，凉、轻，且不属于任何一只已知鸟类。',
  'gpa-charm': 'GPA4.0 神器——抱抱怪送给耐心陪伴者的祝福，据说能带来通宵自习后的好运。',
  'library-reward-ticket': '图书馆奖励券，背面印着借阅榜单，翻过去才看得见。',
  'siyuan-key': '思源楼金钥匙，握在手里比看起来沉，像是压着一整栋楼的记忆。',
  'anomalous-embrace-token': '安抚情绪怪后落下的护符，还带着一点温度（传说物，名称待确认）。',
  'training-bat': '训练棍：入场装备，挥不动人也挥不坏东西。',
  'stun-baton': '电击器：短暂击晕怪物，电量只够使用十五次。',
  'reinforced-bat': '强化训练棍，缠了胶带，手感更稳。',
};

export function findStep(chapter: ChapterContent, stepId: string): ChapterStep | undefined {
  return chapter.steps.find((step) => step.stepId === stepId);
}

/**
 * 拾取任务证据时的剧情提示：把对应步骤的标题与一句氛围文案带回场景提示条，
 * 让剧情在实际游玩中出现，而不是只能事后在档案里翻。
 */
export function evidenceStoryBeat(itemId: string): string | null {
  if (itemId === EVIDENCE_NOTEBOOK) {
    return `【${FIRST_CHAPTER.steps[0]?.title ?? ''}】夹层里抽出半本被水浸过的手记，扉页写着「思源」。`;
  }
  if (itemId === EVIDENCE_FEATHER) {
    return `【${FIRST_CHAPTER.steps[1]?.title ?? ''}】碑身轻震，一枚泛着微光的异常羽毛落进掌心。`;
  }
  return null;
}
