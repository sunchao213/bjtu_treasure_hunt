import rules from '../../config/online-unlock.json';

export function onlineUnlockProgress(completedChapterIds: readonly string[]) {
  const completed = rules.requiredChapterIds.filter((id) =>
    completedChapterIds.includes(id),
  ).length;
  return {
    unlocked: completed === rules.requiredChapterIds.length,
    completed,
    total: rules.requiredChapterIds.length,
    hint: `通关全部三个章节后解锁联机（${completed}/${rules.requiredChapterIds.length}）`,
  };
}
