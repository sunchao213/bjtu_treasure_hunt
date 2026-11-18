import { ITEM_DEFINITIONS, itemValueFor } from '../../config/game-config';
import { CHAPTERS, CODEX_ENTRIES } from '../quests/chapter-content';
import type { Rarity } from '../../shared/types/game';
import { warehouseItemIconAssetPath, warehouseItemDetails } from './warehouse-items';
import { VALUE_COLLECTION_IDS } from './archive-browser';

const rarityNames: Record<Rarity, string> = {
  pending: '待定',
  common: '普通',
  uncommon: '稀有',
  epic: '史诗',
  legendary: '传说',
};
const rarityColors: Record<Rarity, string> = {
  pending: '#9aa69d',
  common: '#c4cfc6',
  uncommon: '#8cd6b3',
  epic: '#c2a2ee',
  legendary: '#f3ce81',
};
const details: Record<string, { icon: string; description: string }> = {
  'portable-medkit': {
    icon: 'medkit',
    description: '使用后恢复 15 点生命并消耗；满血时不能使用，消耗后不再计入携带价值。',
  },
  'library-reward-ticket': {
    icon: 'paper',
    description: '印着借阅榜单的图书馆占座券，史诗收藏物。',
  },
  'scratch-paper': { icon: 'paper', description: '写满演算痕迹的草稿纸，校园里的普通收藏物。' },
  'half-eraser': { icon: 'eraser', description: '只剩半块的橡皮，普通收藏物。' },
  'torn-notebook': {
    icon: 'paper',
    description: '思源楼前固定宝箱中的主线线索；调查明湖石碑并携带本局手记成功撤离，可解锁第一章。',
  },
  'window-seat': { icon: 'seat', description: '靠窗座位的凭证，校园收藏物。' },
  'morning-coffee': {
    icon: 'coffee',
    description: '使用后恢复 25 点生命并消耗；满血时不能使用，消耗后不再计入携带价值。',
  },
  'school-badge': { icon: 'badge', description: '刻有校训的徽章，校园收藏物。' },
  'anomalous-feather': {
    icon: 'feather',
    description: '明湖石碑调查后出现的第一章主线证据，与残缺手记共同构成异常记录。',
  },
  'gpa-charm': { icon: 'badge', description: '校园传说中的护符，作为收藏物计分。' },
  'siyuan-key': { icon: 'key', description: '思源楼主题的传说收藏物，具有较高携带价值。' },
  'strange-veined-ginkgo-leaf': {
    icon: 'leaf',
    description: '校园异闻中的传说收藏物，作为收藏物计分。',
  },
  'hunter-binoculars': {
    icon: 'binoculars',
    description: '校园夜间探索主题的史诗收藏物，作为收藏物计分。',
  },
  'roller-skates': {
    icon: 'skates',
    description: '使用后移动速度提升 15%，持续 5 秒。',
  },
  'training-bat': {
    icon: 'bat',
    description: '携带时用于近身攻击的训练装备；仓库带入不计本局价值。',
  },
  'stun-baton': {
    icon: 'bat',
    description: '可使用 15 次，命中后短暂击晕敌人；仓库带入不计本局价值。',
  },
  'reinforced-bat': {
    icon: 'bat',
    description: '强化近身训练装备，携带时提升攻击伤害；仓库带入不计本局价值。',
  },
  'electric-bike-helmet': {
    icon: 'helmet',
    description: '使用后获得 15 点护盾，持续 5 秒。',
  },
  'david-head-statue': {
    icon: 'statue',
    description: '史诗收藏物；没有额外使用效果。',
  },
  'silver-watch': {
    icon: 'watch',
    description: '传说收藏物；没有额外使用效果。',
  },
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
  return VALUE_COLLECTION_IDS.map((itemId, index) => {
    const item = ITEM_DEFINITIONS[itemId]!;
    const known = unlocked.has(item.itemId);
    const detail = details[item.itemId];
    return {
      id: item.itemId,
      number: String(index + 1).padStart(2, '0'),
      unlocked: known,
      name: known ? item.name : '未发现物品',
      rarity: known ? rarityNames[item.rarity] : '未解锁',
      value: known ? itemValueFor(item) : null,
      description: known
        ? [
            CODEX_ENTRIES[item.itemId],
            warehouseItemDetails(item.itemId)?.description ?? detail?.description ?? '校园收藏物。',
          ]
            .filter(Boolean)
            .join(' ')
        : '搜到物品并成功撤离后点亮此图鉴。',
      color: known ? rarityColors[item.rarity] : '#7d8a82',
      icon: known ? (detail?.icon ?? 'paper') : 'locked',
    };
  });
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
  const images = await Promise.all(
    entries.map(async (entry): Promise<HTMLImageElement | null> => {
      if (!entry.unlocked) return null;
      const src = warehouseItemIconAssetPath(entry.id);
      if (!src) return null;
      const image = new Image();
      image.src = src;
      await image.decode();
      return image;
    }),
  );
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 240 + Math.ceil(entries.length / 3) * 395 + 65;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法生成图鉴图片。');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#2b2521';
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
    `思源密码章节：已解锁 ${chapters.filter((chapterId) => CHAPTERS[chapterId] !== undefined).length} / ${Object.keys(CHAPTERS).length}`,
    48,
    160,
  );
  ctx.font = '20px Microsoft YaHei, sans-serif';
  ctx.fillText('纯价值收藏物 · 成功撤离后永久点亮；未解锁物品显示问号。', 48, 199);
  entries.forEach((entry, index) => {
    const x = 48 + (index % 3) * 452;
    const y = 230 + Math.floor(index / 3) * 395;
    ctx.fillStyle = '#3c3229';
    ctx.fillRect(x, y, 430, 373);
    ctx.strokeStyle = entry.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, 430, 373);
    const image = images[index];
    if (image) {
      ctx.drawImage(image, x + 24, y + 8, 88, 88);
    } else if (!entry.unlocked) {
      ctx.fillStyle = '#c5a373';
      ctx.font = 'bold 64px Georgia, serif';
      ctx.fillText('?', x + 44, y + 75);
    }
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
