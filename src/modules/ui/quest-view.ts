import { ITEM_CATALOG_IDS, ITEM_DEFINITIONS } from '../../config/game-config';
import { QUEST_CHAPTER_ID } from '../quests/quest-service';
import type { QuestProgressView } from '../quests/quest-service';

/**
 * D 的界面渲染：任务进度卡与图鉴 / 剧情档案。
 * 只消费外部传入的快照并更新 DOM，不发起任何业务写入。
 */

const STORY_TITLE = '第一章 · 明湖边的异常羽毛';
const STORY_BODY =
  '你从图书馆外的旧书架夹层里抽出一本残缺手记，按记号擦拭明湖石碑，一枚泛着微光的异常羽毛落进掌心。' +
  '带着它们离开异常区域的那一刻，「思源密码」正式向你敞开。';
const STORY_LOCKED = '未解锁：携带残缺手记与异常羽毛并成功撤离后，可回看本章剧情。';
const UNLOCK_NOTICE = '思源密码 · 第一章已解锁，图鉴与剧情档案可回看。';

export function renderQuestPanel(progress: QuestProgressView): void {
  const count = document.getElementById('quest-count');
  if (count) {
    count.textContent = `${progress.collected} / 2`;
  }
  const steps = document.getElementById('quest-steps');
  if (steps) {
    for (const li of Array.from(steps.querySelectorAll('li'))) {
      const done =
        li.dataset.evidence === 'torn-notebook'
          ? progress.notebook
          : li.dataset.evidence === 'anomalous-feather'
            ? progress.feather
            : false;
      li.classList.toggle('done', done);
    }
  }
  const status = document.getElementById('quest-status');
  if (status) {
    status.textContent = progress.statusText;
  }
}

export interface CodexArchive {
  readonly codexIds: readonly string[];
  readonly unlockedChapterIds: readonly string[];
}

export function renderCodexPanel(
  list: HTMLElement,
  story: HTMLElement,
  archive: CodexArchive,
): void {
  list.replaceChildren();
  for (const itemId of ITEM_CATALOG_IDS) {
    const lit = archive.codexIds.includes(itemId);
    const li = document.createElement('li');
    li.className = lit ? 'lit' : 'unlit';
    li.textContent = `${lit ? '◆' : '◇'} ${ITEM_DEFINITIONS[itemId]?.name ?? itemId}`;
    list.append(li);
  }
  story.replaceChildren();
  const heading = document.createElement('p');
  heading.className = 'story-title';
  heading.textContent = STORY_TITLE;
  const unlocked = archive.unlockedChapterIds.includes(QUEST_CHAPTER_ID);
  const text = document.createElement('p');
  text.className = unlocked ? 'story-body' : 'muted';
  text.textContent = unlocked ? STORY_BODY : STORY_LOCKED;
  story.append(heading, text);
}

export function renderChapterUnlock(target: HTMLElement, granted: boolean): void {
  target.hidden = !granted;
  if (granted) {
    target.textContent = UNLOCK_NOTICE;
  }
}
