import { EVIDENCE_FEATHER, EVIDENCE_NOTEBOOK, QUEST_CHAPTER_ID } from './quest-service';

/**
 * D 的剧情内容（与逻辑分离的纯数据，便于评审文案与后续扩章）。
 *
 * 文字来源：《交大摸金录_剧情设定与章节规划_可编辑稿》v1.1（2026-10-18）。
 * 该版将玩家身份定为普通学生；「思源」是隐藏的思源记录册与记忆保存机制。
 * 本模块只承载文本与展示元数据，不写任何存档，不参与运行时条件判定。
 */

export interface ChapterStep {
  readonly stepId: string;
  /** 第几步（1 起），与任务链顺序一致。 */
  readonly stepNumber: number;
  /** 展示标题：线索一／线索二／线索三 + 短标题。 */
  readonly title: string;
  /** 叙事地点 ID；运行时地图锚点见 STORY_LOCATION_ANCHORS。 */
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
  /** 开场任务文本（文档 6.2，学生视角）。 */
  readonly prologue: string;
  /** 章节结尾与下一章钩子（文档 6.4）。 */
  readonly epilogue: string;
  /** 结算页解锁提示（文档 6.4 结算显示建议）。 */
  readonly settlementSummary: string;
  readonly steps: readonly ChapterStep[];
}

export const FIRST_CHAPTER: ChapterContent = {
  chapterId: QUEST_CHAPTER_ID,
  title: '第一章 · 明湖边的异常羽毛',
  subtitle: '思源记录册 · 第一章档案（学生记录摘录）',
  unlockHint: '携带残缺手记与异常羽毛并成功撤离后，可回看本章剧情。',
  prologue:
    '那天你只是因为忘记带校园卡，回宿舍比平时晚了一点。图书馆外的路灯忽明忽暗，风把一张草稿纸吹到你的脚边。' +
    '纸上写着一串看不懂的公式，最下面却多了一句话：「别走地图上没有的路。」' +
    '你抬起头，发现图书馆外原本空着的旧书架旁，多出了一盏从没见过的灯。' +
    '灯下夹着半本被水浸过的手记，扉页写着两个字：「思源」。',
  epilogue:
    '手记上的字迹逐渐洇开：「你能看见它们。那就别让它们被忘记。」' +
    '随后，册页浮出新的记录：「明湖记录已回收。异常等级：轻度。新的记忆缺口正在生成。」' +
    '校园地图上，除了思源楼，图书馆、教学楼群和南门附近也先后亮起微弱的红点。',
  settlementSummary: '第一章已解锁。思源记录册新增：明湖边的异常羽毛。',
  steps: [
    {
      stepId: 'step-1-library-shelf',
      stepNumber: 1,
      title: '线索一 · 书架夹层里的半本旧册',
      locationId: 'library-outside-shelf',
      requiresEvidence: [],
      stepBody:
        '你本想把手记交给失物招领处，但指尖碰到纸页的瞬间，周围的声音忽然安静下来。' +
        '书架夹层里浮出一行原本不存在的字：「水边有记号的石头，替我把话说完。」' +
        '手机地图短暂失去信号，明湖的位置却自己亮了起来。' +
        '你不知道是谁留下线索，却觉得如果今晚不去那里，手记里的内容可能会彻底消失。',
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
        '你朝南门跑去。身后的路灯一盏接一盏熄灭，校园像被人从地图上慢慢擦掉。' +
        '穿过南门时，手机恢复了信号，明湖、图书馆和路灯都回到原来的位置。只有口袋里的手记证明刚才并非幻觉。' +
        '羽毛失去蓝光，扉页的「思源」二字却渐渐散开，变成新的文字。',
    },
  ],
};

/** 剧情地点的运行时锚点：叙事名 ↔ 地图配置，供展示与测试核对，不参与条件判定。 */
export interface StoryLocationAnchor {
  /** 展示用地点名（与剧情稿叙事名称一致）。 */
  readonly placeName: string;
  /** 锚点类型：loot-zone = 搜索点区域；gate = 撤离点门位。 */
  readonly kind: 'loot-zone' | 'gate';
  /** loot-zone 对应 WORLD.lootZones[].id；gate 对应 WORLD.gates[].name。 */
  readonly anchorId: string;
}

export const STORY_LOCATION_ANCHORS: Readonly<Record<string, StoryLocationAnchor>> = {
  'library-outside-shelf': { placeName: '图书馆外旧书架', kind: 'loot-zone', anchorId: 'library' },
  'minghu-stele': { placeName: '明湖石碑', kind: 'loot-zone', anchorId: 'lake' },
  'south-extraction-point': { placeName: '南门撤离点', kind: 'gate', anchorId: '南门 · 撤离点' },
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
 * 让剧情在实际游玩中出现，而不是只能事后在档案里翻。文案口径见剧情稿表 7。
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
