import rules from '../../config/online-unlock.json';

export function onlineUnlockProgress(completedChapterIds: readonly string[]) {
  const completed = rules.requiredChapterIds.filter((id) =>
    completedChapterIds.includes(id),
  ).length;
  return {
    // 联机暂时开放给所有已登录玩家，章节完成度只用于展示进度。
    unlocked: true,
    completed,
    total: rules.requiredChapterIds.length,
    hint: '联机已开放。',
  };
}
