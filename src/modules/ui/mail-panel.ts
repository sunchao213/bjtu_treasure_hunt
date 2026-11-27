/**
 * 官方邮件页的【临时实现】——正式归属：项会惠。
 *
 * 做它的原因只有一个：仓库硬上限 100 格落地后，撤离结算溢出的物资总得有个地方躺着，
 * 否则会凭空消失。所以这里只做了「补发物资领取」这一个最小闭环，没有做已读、删除、
 * 附件预览、奖励邮件分类——这些都归项会惠的正式设计。
 *
 * 替换时只需要满足两点，其它随便改：
 *   1. 调用方（game.ts 的 render）仍然调用 `renderMailPanel(root, input)`；
 *   2. 保留挂载点 `#lobby-mail-list` / `#lobby-mail-empty` / `#lobby-mail-meta` /
 *      `#mail-claim-all` / `#lobby-mail-status`，或者同步改 game.ts 里那一行。
 * 领取动作走存档层 `SavePort.claimMail(mailId | null)`，与界面无关。
 */
import { ITEM_DEFINITIONS, WAREHOUSE_CAPACITY } from '../../config/game-config';
import type { MailItem } from '../../shared/types/game';
import { warehouseItemIconAssetPath } from './warehouse-items';

const pad = (value: number): string => String(value).padStart(2, '0');

function formatTime(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 同一封信里相同物品合并成一条「名称 ×N」，避免爆仓时几十个图标糊满一屏 */
interface MailChip {
  itemId: string;
  name: string;
  count: number;
}

function chipsOf(mail: MailItem): MailChip[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const item of mail.attachments) {
    const count = counts.get(item.itemId);
    if (count === undefined) {
      order.push(item.itemId);
      counts.set(item.itemId, 1);
    } else {
      counts.set(item.itemId, count + 1);
    }
  }
  return order.map((itemId) => ({
    itemId,
    name: ITEM_DEFINITIONS[itemId]?.name ?? itemId,
    count: counts.get(itemId) ?? 1,
  }));
}

function renderChip(chip: MailChip): HTMLElement {
  const node = document.createElement('span');
  node.className = 'mail-chip';
  node.dataset.rarity = ITEM_DEFINITIONS[chip.itemId]?.rarity ?? 'common';
  const icon = warehouseItemIconAssetPath(chip.itemId);
  if (icon) {
    const image = document.createElement('img');
    image.src = icon;
    image.alt = '';
    image.draggable = false;
    node.append(image);
  }
  const name = document.createElement('i');
  name.textContent = chip.name;
  node.append(name);
  if (chip.count > 1) {
    const count = document.createElement('b');
    count.textContent = `×${chip.count}`;
    node.append(count);
  }
  return node;
}

function renderMail(mail: MailItem, warehouseCount: number): HTMLElement {
  const room = Math.max(0, WAREHOUSE_CAPACITY - warehouseCount);
  const item = document.createElement('li');
  item.className = 'mail-item';
  item.dataset.mailId = mail.mailId;

  const head = document.createElement('div');
  head.className = 'mail-head';
  const title = document.createElement('b');
  title.className = 'mail-title';
  title.textContent = mail.title;
  const time = document.createElement('span');
  time.className = 'mail-time';
  time.textContent = formatTime(mail.createdAt);
  head.append(title, time);

  const body = document.createElement('p');
  body.className = 'mail-body';
  body.textContent = mail.body;

  const chips = document.createElement('div');
  chips.className = 'mail-chips';
  for (const chip of chipsOf(mail)) chips.append(renderChip(chip));

  const footer = document.createElement('div');
  footer.className = 'mail-footer';
  const hint = document.createElement('span');
  hint.className = 'mail-hint';
  hint.textContent =
    room === 0
      ? `仓库已满（${warehouseCount}/${WAREHOUSE_CAPACITY}），先腾出格子`
      : room >= mail.attachments.length
        ? `仓库余量 ${room} 格，可全部领取`
        : `仓库只剩 ${room} 格，本次先领 ${room} 件`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mail-claim';
  button.dataset.mailClaim = mail.mailId;
  button.disabled = room === 0;
  button.textContent =
    room === 0 ? '仓库已满' : `领取 ${Math.min(room, mail.attachments.length)} 件`;
  footer.append(hint, button);

  item.append(head, body, chips, footer);
  return item;
}

export interface MailPanelInput {
  readonly mailbox: readonly MailItem[];
  readonly warehouseCount: number;
  /** 上一次操作的结果文案（领取失败/部分领取时给玩家一个交代） */
  readonly status?: string;
  readonly busy?: boolean;
}

/** 整块重绘邮件页：信箱只承载「仓库爆仓补发」，所以没有已读/删除，领完即消失。 */
export function renderMailPanel(root: ParentNode, input: MailPanelInput): void {
  const list = root.querySelector<HTMLElement>('#lobby-mail-list');
  const empty = root.querySelector<HTMLElement>('#lobby-mail-empty');
  const meta = root.querySelector<HTMLElement>('#lobby-mail-meta');
  const claimAll = root.querySelector<HTMLButtonElement>('#mail-claim-all');
  const status = root.querySelector<HTMLElement>('#lobby-mail-status');
  if (!list || !empty || !meta || !claimAll || !status) return;

  const count = input.mailbox.length;
  const total = input.mailbox.reduce((sum, mail) => sum + mail.attachments.length, 0);
  meta.textContent = count === 0 ? '0 封未读' : `${count} 封未读 · ${total} 件待领`;
  list.replaceChildren(...input.mailbox.map((mail) => renderMail(mail, input.warehouseCount)));
  list.hidden = count === 0;
  empty.hidden = count > 0;

  claimAll.disabled = count === 0 || input.busy || input.warehouseCount >= WAREHOUSE_CAPACITY;
  claimAll.textContent = input.busy ? '正在领取…' : '全部领取';
  status.textContent = input.status ?? '';
  status.dataset.state = input.status ? 'info' : '';
}
