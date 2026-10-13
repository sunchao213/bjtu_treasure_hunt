import { ITEM_CATALOG_IDS, ITEM_DEFINITIONS, RAID_RULES } from '../../config/game-config';
import { CODEX_ENTRIES } from '../quests/chapter-content';
import type { Rarity } from '../../shared/types/game';

const rarityNames: Record<Rarity, string> = {
  common: '普通',
  uncommon: '稀有',
  epic: '史诗',
  legendary: '传说',
};
const rarityColors: Record<Rarity, string> = {
  common: '#c4cfc6',
  uncommon: '#8cd6b3',
  epic: '#c2a2ee',
  legendary: '#f3ce81',
};
const details: Record<string, { icon: string; description: string }> = {
  'portable-medkit': {
    icon: 'medkit',
    description: '使用后恢复 30 点生命并消耗；满血时不能使用，消耗后不再计入携带价值。',
  },
  'library-reward-ticket': { icon: 'paper', description: '图书馆主题的史诗收藏物。' },
  'anomalous-embrace-token': {
    icon: 'badge',
    description: '抱抱机制关联的传说收藏物，名称待小组确认。',
  },
  'scratch-paper': { icon: 'paper', description: '写满演算痕迹的草稿纸，校园里的普通收藏物。' },
  'half-eraser': { icon: 'eraser', description: '只剩半块的橡皮，普通收藏物。' },
  'campus-map': { icon: 'map', description: '一张校园地图线索，作为收藏物计入携带价值。' },
  'torn-notebook': {
    icon: 'paper',
    description: '图书馆周边的主线线索；与本局异常羽毛一起带回可解锁思源密码章节。',
  },
  'window-seat': { icon: 'seat', description: '靠窗座位的凭证，校园收藏物。' },
  'morning-coffee': {
    icon: 'coffee',
    description: '使用后恢复 25 点生命并消耗；满血时不能使用，消耗后不再计入携带价值。',
  },
  'school-badge': { icon: 'badge', description: '刻有校训的徽章，校园收藏物。' },
  'anomalous-feather': {
    icon: 'feather',
    description: '明湖石碑周边的主线线索；与本局残缺手记一起成功撤离可解锁章节。',
  },
  'gpa-charm': { icon: 'badge', description: '安抚抱抱怪后可能获得的护符，作为收藏物计分。' },
  'siyuan-key': { icon: 'key', description: '思源楼主题的传说收藏物，具有较高携带价值。' },
  'training-bat': {
    icon: 'bat',
    description: '携带时用于近身攻击的训练装备；仓库带入不计本局价值。',
  },
  'reinforced-bat': {
    icon: 'bat',
    description: '强化近身训练装备，携带时提升攻击伤害；仓库带入不计本局价值。',
  },
};
const iconPaths: Record<string, string> = {
  medkit: 'M10 18H54V54H10Z M24 18V10H40V18 M28 28H36V34H42V42H36V48H28V42H22V34H28Z',
  paper: 'M16 8H42L50 16V56H16Z M42 8V18H50 M24 28H42 M24 36H42 M24 44H36',
  eraser: 'M10 38L34 14L54 34L30 58H22Z M24 24L44 44 M30 58H54',
  map: 'M8 16L24 10L40 16L56 10V48L40 54L24 48L8 54Z M24 10V48 M40 16V54 M29 29L35 35 M35 29L29 35',
  seat: 'M18 8H48V34H18Z M18 34L12 42H52L48 34 M16 42V56 M48 42V56 M24 15V27 M40 15V27',
  coffee:
    'M12 22H44V46Q44 54 36 54H20Q12 54 12 46Z M44 26H50Q58 26 54 36Q52 40 44 40 M20 8V15 M32 8V15',
  badge:
    'M32 8L40 21L55 24L45 36L46 52L32 46L18 52L19 36L9 24L24 21Z M26 28L32 24L38 28V36L32 40L26 36Z',
  feather:
    'M12 54L46 14 M18 46Q8 28 32 12Q44 4 54 10Q60 26 42 42Q30 52 18 46 M26 38L24 22 M34 29L49 28',
  key: 'M24 10A14 14 0 1 1 24 38A14 14 0 1 1 24 10 M24 19A5 5 0 1 1 24 29A5 5 0 1 1 24 19 M34 34L54 54 M44 44L50 38 M50 50L56 44',
  bat: 'M12 54L19 47 M16 49L34 25Q42 10 49 10Q56 10 54 18Q51 26 38 31L22 52Z M31 31L37 37',
  locked: 'M18 27V19A14 14 0 0 1 46 19V27 M12 27H52V56H12Z M32 37V46',
};

export interface CodexEntry {
  readonly id: string;
  readonly number: string;
  readonly unlocked: boolean;
  readonly name: string;
  readonly rarity: string;
  readonly value: number | null;
  readonly description: string;
  readonly color: string;
  readonly icon: string;
}

/** Only persisted codex IDs unlock entries; warehouse possession is not required. */
export function getCodexEntries(ids: readonly string[]): CodexEntry[] {
  const unlocked = new Set(ids);
  return ITEM_CATALOG_IDS.map((itemId, index) => {
    const item = ITEM_DEFINITIONS[itemId]!;
    const known = unlocked.has(item.itemId);
    const detail = details[item.itemId];
    return {
      id: item.itemId,
      number: String(index + 1).padStart(2, '0'),
      unlocked: known,
      name: known ? item.name : '未发现物品',
      rarity: known ? rarityNames[item.rarity] : '未解锁',
      value: known ? RAID_RULES.values[item.rarity] : null,
      description: known
        ? [CODEX_ENTRIES[item.itemId], detail?.description ?? '校园收藏物。']
            .filter(Boolean)
            .join(' ')
        : '搜到物品并成功撤离后点亮此图鉴。',
      color: known ? rarityColors[item.rarity] : '#7d8a82',
      icon: known ? (detail?.icon ?? 'paper') : 'locked',
    };
  });
}

export function codexMarkup(): string {
  return `<dialog id="codex-dialog" class="rules-dialog codex-dialog" aria-labelledby="codex-title">
    <header class="rules-header"><div><p class="rules-eyebrow">交大摸金录 · 收藏档案</p><h1 id="codex-title">物品图鉴 <small id="codex-count"></small></h1></div>
      <button id="close-codex" class="rules-close" aria-label="关闭图鉴">×</button></header>
    <div class="codex-content"><p>成功撤离后永久点亮；带入、丢弃或消耗已收藏物品不会熄灭图鉴。未解锁物品显示剪影。</p>
      <p id="codex-chapter"></p><div id="codex-grid" class="codex-grid"></div></div>
    <footer class="rules-footer codex-footer"><button id="export-codex" class="primary">导出图鉴图片（PNG）</button><span id="codex-export-status" role="status" aria-live="polite"></span></footer>
  </dialog>`;
}

export function renderCodex(ids: readonly string[], chapters: readonly string[]): void {
  const entries = getCodexEntries(ids);
  const grid = document.getElementById('codex-grid');
  if (!grid) return;
  document.getElementById('codex-count')!.textContent =
    `${entries.filter((e) => e.unlocked).length} / ${entries.length}`;
  document.getElementById('codex-chapter')!.textContent = chapters.includes('siyuan-code')
    ? '章节：思源密码已解锁'
    : '章节：思源密码未解锁 · 需携带本局残缺手记与异常羽毛成功撤离';
  grid.replaceChildren();
  for (const entry of entries) {
    const card = document.createElement('article');
    card.className = `codex-card${entry.unlocked ? '' : ' codex-locked'}`;
    card.style.setProperty('--codex-color', entry.color);
    const visual = document.createElement('div');
    visual.className = 'codex-visual';
    // Paths are local constants, never content from a save file.
    visual.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="${iconPaths[entry.icon]}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const number = document.createElement('small');
    number.textContent = `NO. ${entry.number}`;
    visual.append(number);
    const name = document.createElement('h2');
    name.textContent = entry.name;
    const rarity = document.createElement('p');
    rarity.className = 'codex-rarity';
    rarity.textContent = `${entry.rarity}${entry.value === null ? '' : ` · ${entry.value} 价值`}`;
    const description = document.createElement('p');
    description.textContent = entry.description;
    card.append(visual, name, rarity, description);
    grid.append(card);
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
): void {
  let line = '';
  for (const char of text) {
    if (line && ctx.measureText(line + char).width > width && !'。，；：！？、'.includes(char)) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = '';
    }
    line += char;
  }
  if (line) ctx.fillText(line, x, y);
}

/** Render a standalone image from the same entry model as the in-game gallery. */
export async function exportCodexImage(
  ids: readonly string[],
  chapters: readonly string[],
): Promise<void> {
  await document.fonts.ready;
  const entries = getCodexEntries(ids);
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 240 + Math.ceil(entries.length / 3) * 395 + 65;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法生成图鉴图片。');
  ctx.fillStyle = '#14221e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffe3a0';
  ctx.font = 'bold 44px Microsoft YaHei, sans-serif';
  ctx.fillText('交大摸金录 · 物品图鉴', 48, 75);
  ctx.font = '24px Microsoft YaHei, sans-serif';
  ctx.fillStyle = '#cfdbd2';
  ctx.fillText(
    `已点亮 ${entries.filter((e) => e.unlocked).length} / ${entries.length} · ${new Date().toLocaleDateString('zh-CN')}`,
    48,
    120,
  );
  ctx.fillText(
    chapters.includes('siyuan-code') ? '思源密码章节：已解锁' : '思源密码章节：未解锁',
    48,
    160,
  );
  ctx.font = '20px Microsoft YaHei, sans-serif';
  ctx.fillText('成功撤离后点亮图鉴；未解锁物品仅展示剪影。', 48, 199);
  entries.forEach((entry, index) => {
    const x = 48 + (index % 3) * 452;
    const y = 230 + Math.floor(index / 3) * 395;
    ctx.fillStyle = '#20332b';
    ctx.fillRect(x, y, 430, 373);
    ctx.strokeStyle = entry.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, 430, 373);
    ctx.save();
    ctx.translate(x + 24, y + 15);
    ctx.scale(1.1, 1.1);
    ctx.strokeStyle = entry.color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(iconPaths[entry.icon]));
    ctx.restore();
    ctx.fillStyle = entry.color;
    ctx.font = '18px Microsoft YaHei, sans-serif';
    ctx.fillText(`NO. ${entry.number}`, x + 333, y + 42);
    ctx.font = 'bold 27px Microsoft YaHei, sans-serif';
    wrapText(ctx, entry.name, x + 24, y + 119, 382, 32);
    ctx.font = '21px Microsoft YaHei, sans-serif';
    ctx.fillText(
      `${entry.rarity}${entry.value === null ? '' : ` · ${entry.value} 价值`}`,
      x + 24,
      y + 187,
    );
    ctx.fillStyle = '#c5d1c9';
    ctx.font = '19px Microsoft YaHei, sans-serif';
    wrapText(ctx, entry.description, x + 24, y + 223, 382, 27);
  });
  ctx.fillStyle = '#a8b8ad';
  ctx.font = '18px Microsoft YaHei, sans-serif';
  ctx.fillText('北京交通大学海淀主校区 · 夜间搜打撤 · 当前浏览器收藏记录', 48, canvas.height - 30);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('图鉴图片生成失败，请重试。'))),
      'image/png',
    ),
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `交大摸金录-图鉴-${new Date().toLocaleDateString('sv-SE')}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
