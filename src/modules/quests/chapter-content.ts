import {
  EVIDENCE_CAMPUS_MAP,
  EVIDENCE_COMPLETE_RECORD,
  EVIDENCE_NOTEBOOK,
  EVIDENCE_SIYUAN_KEY,
  EVIDENCE_SOOTHE_CHARM,
  QUEST_CHAPTER_ID,
  SECOND_CHAPTER_ID,
  THIRD_CHAPTER_ID,
} from './quest-service';

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
  title: '第一章 · 思源楼前的残缺手记',
  subtitle: '思源记录册 · 第一章档案（学生记录摘录）',
  unlockHint: '携带本局残缺手记、调查明湖石碑并成功撤离后，可回看本章剧情。',
  prologue:
    '那天你只是因为忘记带校园卡，回宿舍比平时晚了一点。思源楼前的路灯忽明忽暗，风把一张草稿纸吹到你的脚边。' +
    '纸上写着一串看不懂的公式，最下面却多了一句话：「别走地图上没有的路。」' +
    '你抬起头，发现思源楼前原本空着的地方，多出了一只落满灰尘的宝箱。' +
    '箱中放着半本被水浸过的手记，扉页写着两个字：「思源」。',
  epilogue:
    '石碑上的字迹逐渐洇开：「你能看见它们。那就别让它们被忘记。」' +
    '随后，册页浮出新的记录：「明湖记录已回收。新的记忆缺口正在生成。」' +
    '校园地图上，除了思源楼，图书馆、教学楼群和南门附近也先后亮起微弱的红点。',
  settlementSummary: '第一章已解锁。思源记录册新增：思源楼前的残缺手记与明湖石碑调查记录。',
  steps: [
    {
      stepId: 'step-1-siyuan-chest',
      stepNumber: 1,
      title: '线索一 · 思源楼前的残缺手记',
      locationId: 'siyuan-notebook-chest',
      requiresEvidence: [],
      stepBody:
        '你本想把手记交给失物招领处，但指尖碰到纸页的瞬间，周围的声音忽然安静下来。' +
        '手记上浮出一行原本不存在的字：「水边有记号的石头，替我把话说完。」' +
        '手机地图短暂失去信号，明湖石碑的位置却自己亮了起来。' +
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
        '你照着手记上的笔画描了一遍，碑身轻轻震了一下，石面上浮出一行褪色的字。' +
        '水面上浮起一圈不属于路灯的蓝光，随即熄灭。你意识到：这段记录不能留在这里，必须带着手记离开。',
    },
    {
      stepId: 'step-3-south-extraction',
      stepNumber: 3,
      title: '线索三 · 带着证据走出异常区域',
      locationId: 'south-extraction-point',
      requiresEvidence: [EVIDENCE_NOTEBOOK, 'minghu-stele'],
      stepBody:
        '你朝南门跑去。身后的路灯一盏接一盏熄灭，校园像被人从地图上慢慢擦掉。' +
        '穿过南门时，手机恢复了信号，明湖、图书馆和路灯都回到原来的位置。只有口袋里的手记证明刚才并非幻觉。' +
        '扉页的「思源」二字渐渐散开，变成新的文字。',
    },
  ],
};

export const SECOND_CHAPTER: ChapterContent = {
  chapterId: SECOND_CHAPTER_ID,
  title: '第二章 · 失效的思源钥匙',
  subtitle: '思源记录册 · 第二章档案（学生记录摘录）',
  unlockHint: '完成第一章，并携带被涂改的校园地图与思源楼金钥匙成功撤离后，可回看本章剧情。',
  prologue:
    '手记上「思源楼」三个字还没有完全干透，册页就自己浮出新的记录：「记录节点 02 已失效。」' +
    '你翻开校园地图，发现好几条路线被人反复描粗，其中一条并不通向任何开放入口，却在夜里指向思源楼侧门。' +
    '地图角落多了一行小字：「别走最短的路，走还记得你的路。」',
  epilogue:
    '钥匙并没有打开门，而是打开了一段被封存的记录。' +
    '上一位记录者留在里面的讯息说，自己不是失踪，而是主动删去了某段记录，因为那段记录会把所有情绪反应都变成怪物。' +
    '最后一句话被擦去，只剩「不要让它独自醒来」。' +
    '册页随即浮出：「记录节点 02 已恢复。」远处的芳华园里，有什么正在发出断断续续的求助。',
  settlementSummary:
    '第二章已解锁。思源记录册新增：失效的思源钥匙。下一目标：回应芳华园的不稳定信号。',
  steps: [
    {
      stepId: 'step-1-marked-campus-map',
      stepNumber: 1,
      title: '线索一 · 被涂改的校园地图',
      locationId: 'campus-map-point',
      requiresEvidence: [],
      stepBody:
        '你在中央教学楼下方、树丛旁的公告栏上发现一张被反复描粗的校园地图，其中一条路线并不通往任何开放入口。' +
        '地图角落写着：「别走最短的路，走还记得你的路。」' +
        '描粗的线条在夜里微微发亮，一直延伸到思源楼侧门。',
    },
    {
      stepId: 'step-2-keyless-door',
      stepNumber: 2,
      title: '线索二 · 没有钥匙孔的门',
      locationId: 'siyuan-key-point',
      requiresEvidence: [EVIDENCE_CAMPUS_MAP],
      stepBody:
        '思源楼东侧道路的门边没有钥匙孔，只有一块会吞掉反光的金属牌。' +
        '你把地图上描粗的路线与门牌对应后，牌面浮出「记录节点 02 已失效」。' +
        '门缝里掉出一把沉重的钥匙，落在地上时扬起一小片不属于这个季节的灰尘。',
    },
    {
      stepId: 'step-3-deleted-page',
      stepNumber: 3,
      title: '线索三 · 被删除的一页',
      locationId: 'south-extraction-point',
      requiresEvidence: [EVIDENCE_CAMPUS_MAP, EVIDENCE_SIYUAN_KEY],
      stepBody:
        '你带着地图和钥匙往南门跑。侧门的金属牌在身后慢慢暗下去，像被谁合上了一页。' +
        '穿过南门时，钥匙在你掌心轻轻震了一下，一段被封存的记录随之展开。' +
        '记录的最后一句被擦得只剩痕迹：不要让它独自醒来。',
    },
  ],
};

export const THIRD_CHAPTER: ChapterContent = {
  chapterId: THIRD_CHAPTER_ID,
  title: '第三章 · 被抱住的怪物',
  subtitle: '思源记录册 · 第三章档案（学生记录摘录）',
  unlockHint: '完成第二章，并携带安抚护符与完整记录成功撤离后，可回看本章剧情。',
  prologue:
    '凌晨的校园安静得不正常。你刚走进芳华园，就听见一段断断续续的声音：「别关灯……我找不到回去的路。」' +
    '任务面板没有把它标成敌人，只写着一行小字：不稳定信号。' +
    '你握紧手电，却没有把手电对准它——这一次，它看起来更像是需要有人留下。',
  epilogue:
    '护符贴上掌心的一刻，你听见最后一句话：「我不是在追你，我只是怕被忘记。」' +
    '册页翻到空白的一页，慢慢显出一行新字：思源记录机制原本用于保存记忆，却因长期无人理解与整理，' +
    '把未被记录的情绪当成了噪声清除。' +
    '角落里还有一段被人主动删去的记录，静静等着下一次夜里被找回。',
  settlementSummary: '第三章已解锁。思源记录册新增：被抱住的怪物。新档案：被主动删除的记录。',
  steps: [
    {
      stepId: 'step-1-hear-the-request',
      stepNumber: 1,
      title: '线索一 · 先听见请求',
      locationId: 'garden-sos',
      requiresEvidence: [],
      stepBody:
        '你在芳华园收到一段断续的求助：「别关灯……我找不到回去的路。」' +
        '任务面板没有把它标成敌人，而是标为不稳定信号。' +
        '它没有扑过来，只是缩在路灯照不到的地方，像一段被人忘在原地的记忆。',
    },
    {
      stepId: 'step-2-soothe-not-subdue',
      stepNumber: 2,
      title: '线索二 · 安抚不是制服',
      locationId: 'garden-sos',
      requiresEvidence: [EVIDENCE_SOOTHE_CHARM],
      stepBody:
        '你在有限的时间里靠近它，把手电放低，等它的呼吸慢下来。' +
        '安抚成功的那一刻，它没有消失，只留下了一枚仍有余温的护符。' +
        '护符上刻着一句可读的字：「我不是在追你，我只是怕被忘记。」',
    },
    {
      stepId: 'step-3-complete-record',
      stepNumber: 3,
      title: '线索三 · 完整记录',
      locationId: 'south-extraction-point',
      requiresEvidence: [EVIDENCE_SOOTHE_CHARM, EVIDENCE_COMPLETE_RECORD],
      stepBody:
        '护符与前两章的证据在记录册里对应上了。你终于明白：思源机制原本用于保存记忆，' +
        '却因为长期无人理解与整理，把未被记录的情绪当成噪声清除。' +
        '你带着护符和完整记录穿过南门，册页第一次没有出现新的红点，而是安静地翻回第一页。',
    },
  ],
};

/** 三章档案：按章节 id 回看；第一章保持默认，兼容既有入口。 */
export const CHAPTERS: Readonly<Record<string, ChapterContent>> = {
  [FIRST_CHAPTER.chapterId]: FIRST_CHAPTER,
  [SECOND_CHAPTER.chapterId]: SECOND_CHAPTER,
  [THIRD_CHAPTER.chapterId]: THIRD_CHAPTER,
};

export function chapterContentById(chapterId: string): ChapterContent {
  return CHAPTERS[chapterId] ?? FIRST_CHAPTER;
}

/** 剧情地点的运行时锚点：叙事名 ↔ 地图配置，供展示与测试核对，不参与条件判定。 */
export interface StoryLocationAnchor {
  /** 展示用地点名（与剧情稿叙事名称一致）。 */
  readonly placeName: string;
  /** 锚点类型：loot-zone = 搜索点区域；gate = 撤离点门位。 */
  readonly kind: 'loot-zone' | 'gate' | 'quest-chest' | 'point';
  /** 锚点 ID 对应地图区域、宝箱 ID、地图地标或撤离点名称。 */
  readonly anchorId: string;
}

export const STORY_LOCATION_ANCHORS: Readonly<Record<string, StoryLocationAnchor>> = {
  'siyuan-notebook-chest': {
    placeName: '思源楼前',
    kind: 'quest-chest',
    anchorId: 'siyuan-notebook-chest',
  },
  'minghu-stele': { placeName: '明湖石碑', kind: 'point', anchorId: 'minghu-stele' },
  'south-extraction-point': { placeName: '南门撤离点', kind: 'gate', anchorId: '南门 · 撤离点' },
  'campus-map-point': {
    placeName: '教学楼群公告栏',
    kind: 'point',
    anchorId: 'campus-map-point',
  },
  'siyuan-key-point': {
    placeName: '思源楼东侧道路',
    kind: 'point',
    anchorId: 'siyuan-key-point',
  },
  'garden-sos': { placeName: '芳华园', kind: 'loot-zone', anchorId: 'east-garden' },
};

/** 图鉴条目描述：所有可入仓物品都有对应说明。 */
export const CODEX_ENTRIES: Readonly<Record<string, string>> = {
  'scratch-paper': '写满公式又划掉的草稿纸，边角还留着自习室的桌号。',
  'half-eraser': '用到只剩半块的橡皮，擦得最干净的一角写着「别放弃」。',
  'campus-map': '手绘的校园地图，几处角落被反复描粗——像是有人不想被忘记。',
  'portable-medkit': '随身恢复包，第一节课后就一直躺在书包侧袋里。',
  'torn-notebook': '思源楼前宝箱里发现的半本手记，扉页只剩「思源」二字。',
  'window-seat': '靠窗座凭证：图书馆二楼西侧那排座位，冬天下午最暖的位置。',
  'morning-coffee': '早八不困咖啡，热气挡不住困意，但能让人撑过前三节。',
  'school-badge': '校训徽章，别在包带上，走夜路时反着光。',
  'anomalous-feather': '一枚凉而轻的羽毛，不属于任何一只已知鸟类。',
  'gpa-charm': 'GPA 4.0 护符——据说只在通宵自习后才会出现。',
  'library-reward-ticket': '图书馆奖励券，背面印着借阅榜单，翻过去才看得见。',
  'siyuan-key': '思源楼金钥匙，握在手里比看起来沉，像是压着一整栋楼的记忆。',
  'soothe-charm': '安抚护符，贴着掌心仍有余温，刻着「我不是在追你，我只是怕被忘记」。',
  'complete-record': '思源记录册的完整一页，记着一段被主动删除的情绪，与前面三章的证据一一对应。',
  'training-bat': '训练棍：入场装备，挥不动人也挥不坏东西。',
  'stun-baton': '电击器：短暂击晕怪物，电量只够使用十五次。',
  bandage: '创可贴：使用后恢复 10 点生命值。',
  'yellow-bike': '小黄车：使用后移动速度提升 20%。',
  'thick-down-jacket': '超厚羽绒服：使用后获得 5 秒无敌状态。',
  'reinforced-bat': '强化训练棍，缠了胶带，手感更稳。',
};

export function findStep(chapter: ChapterContent, stepId: string): ChapterStep | undefined {
  return chapter.steps.find((step) => step.stepId === stepId);
}

/** 各章证据拾取时的氛围文案（配合对应步骤标题一起显示）。 */
const EVIDENCE_BEAT_TEXT: Readonly<Record<string, string>> = {
  [EVIDENCE_NOTEBOOK]: '打开思源楼前的宝箱，里面是半本被水浸过的手记，扉页写着「思源」。',
  [EVIDENCE_CAMPUS_MAP]: '地图角落描粗的路线在夜里发亮，一直指向思源楼侧门。',
  [EVIDENCE_SIYUAN_KEY]: '门缝里掉出一把沉重的金钥匙，金属牌上写着「记录节点 02 已失效」。',
  [EVIDENCE_SOOTHE_CHARM]: '不稳定信号平静下来，留下了一枚仍有余温的护符。',
  [EVIDENCE_COMPLETE_RECORD]: '护符与记录册对应上了，完整记录在册页上慢慢显形。',
};

/** 证据所属章节与在章节中的步骤下标。 */
const EVIDENCE_STEP_LOCATION: Readonly<Record<string, { chapterId: string; index: number }>> = {
  [EVIDENCE_NOTEBOOK]: { chapterId: QUEST_CHAPTER_ID, index: 0 },
  [EVIDENCE_CAMPUS_MAP]: { chapterId: SECOND_CHAPTER_ID, index: 0 },
  [EVIDENCE_SIYUAN_KEY]: { chapterId: SECOND_CHAPTER_ID, index: 1 },
  [EVIDENCE_SOOTHE_CHARM]: { chapterId: THIRD_CHAPTER_ID, index: 0 },
  [EVIDENCE_COMPLETE_RECORD]: { chapterId: THIRD_CHAPTER_ID, index: 1 },
};

export function steleStoryBeat(): string {
  return `【${FIRST_CHAPTER.steps[1]?.title ?? ''}】你在明湖石碑上找到了手记所说的记号，调查记录已写入本局任务。`;
}

/**
 * 拾取任务证据时的剧情提示：把对应步骤的标题与一句氛围文案带回场景提示条，
 * 让剧情在实际游玩中出现，而不是只能事后在档案里翻。文案口径见剧情稿表 7。
 */
export function evidenceStoryBeat(itemId: string): string | null {
  const beat = EVIDENCE_BEAT_TEXT[itemId];
  const location = EVIDENCE_STEP_LOCATION[itemId];
  if (beat === undefined || location === undefined) {
    return null;
  }
  const step = chapterContentById(location.chapterId).steps[location.index];
  return `【${step?.title ?? ''}】${beat}`;
}
