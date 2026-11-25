import { RAID_RULES } from '../../config/game-config';
import { iconSvg } from './icons';

export function gameRulesMarkup(): string {
  return `
    <dialog id="game-rules" class="rules-dialog" aria-labelledby="rules-title">
      <header class="rules-header"><div><p class="rules-eyebrow">海淀校区 · 夜巡</p><h1 id="rules-title">游戏规则</h1></div>
        <button id="close-rules" class="rules-close" aria-label="关闭游戏规则" title="关闭">${iconSvg('close', { size: 24 })}</button></header>
      <div class="rules-content">
        <section><h2>搜集物资，活着撤离</h2>
          <p>每局 ${RAID_RULES.durationMs / 60_000} 分钟，初始生命 ${RAID_RULES.maxHealth}，背包 6 格、带入道具另有 6 格（初始武器占 1 格，小黄车占 2 格）。搜到并仍携带的本局物资价值达到 <strong>${RAID_RULES.threshold}</strong> 后，回到南门撤离点申请撤离。</p>
          <p>物资箱每局在可到达的区域随机生成。只有开启且有电的手电筒直接照亮箱子时才会显露；环境微光、灯站和照明棒不能发现箱子。照亮后靠近并停住并长按 E 搜索：普通宝箱 2 秒、中级宝箱 4 秒、高级宝箱 6 秒。移动、松开按键、移开手电或受伤会中断搜索；背包已满时箱内物品保留。</p></section>
        <section><h2>分级宝箱</h2><p>每局随机刷新普通宝箱 6 个、蓝色中级宝箱 4 个、紫色高级宝箱 1 个；各级宝箱的位置随每局变化，剧情箱独立保留。蓝色中级宝箱分散在多个区域，稀有／史诗／传说掉落概率为 40%／58%／2%。紫色高级宝箱每局 1 个，位于远离撤离点的巡逻区域，史诗／传说掉落概率为 90%／10%。每箱 1 件物品，直接搜索即可开启；普通宝箱保留小概率极品掉落。</p></section>
        <section><h2>物品价值</h2><dl class="rarity-values">
          <div><dt><i class="rarity-dot common"></i>普通</dt><dd>${RAID_RULES.values.common}</dd></div>
          <div><dt><i class="rarity-dot uncommon"></i>稀有</dt><dd>${RAID_RULES.values.uncommon}</dd></div>
          <div><dt><i class="rarity-dot epic"></i>史诗</dt><dd>${RAID_RULES.values.epic}</dd></div>
          <div><dt><i class="rarity-dot legendary"></i>传说</dt><dd>${RAID_RULES.values.legendary}</dd></div></dl>
          <p>仓库带入物不计本局价值。丢弃或使用物品后立即重算，重新捡起不会重复计分。咖啡可恢复 25 点生命，满血时不会消耗。</p></section>
        <section><h2>撤离条件</h2><p>在南门撤离区域按 E 或点击“开始撤离”，保持在区域内 ${RAID_RULES.extractionDurationMs / 1000} 秒。受伤、离开区域或携带价值降到 ${RAID_RULES.threshold} 以下，读条归零，需要重新申请。</p>
          <p>成功撤离后，探索发现会收入物品图鉴；探索获得的功能物品和商店购买道具会保存在永久仓库。点击“物品图鉴”查看探索收藏和用途，支持导出 PNG 图鉴图片；存档管理中的 JSON 用于备份。死亡、超时、放弃或刷新页面会损失本局全部携带物，包括带入装备；未带入的仓库物品保留。存档保存在当前浏览器。</p></section>
        <section><h2>海淀主校区地图</h2><p>校园夜景图作为静态地图底图，游戏使用正交俯视坐标，地图布局和道路方向沿用原图。南门是出生点和唯一正式撤离点，其他校园区域用于搜索与遭遇。</p>
          <p>建筑和湖面会阻挡移动与视线，宝箱散布在可通行位置，不显示在概览图中。点击右上角校园图可以放大查看底图和当前位置，查看时暂停。宝箱仍必须用手电发现。地图按游戏坐标调整，仅供游戏使用，不能用于现实导航。</p><p>中级宝箱为蓝色，掉落稀有／史诗／传说的概率为 40%／58%／2%；高级宝箱为紫色，每局 1 个，掉落史诗／传说的概率为 90%／10%。每箱 1 件物品，直接搜索即可开启；普通宝箱仍有小概率掉落极品。中级箱分散在多个区域，高级箱位于远离撤离点的巡逻区域。</p></section>
        <section><h2>夜间照明</h2><p>手电开启时持续耗电，也更容易被巡逻敌人发现。每局提供 2 节备用电池、2 根照明棒；照明棒持续 30 秒。每局随机生成 3 个充电桩，靠近后停住并长按 E 2 秒可以充满手电；路灯仅提供照明。灯光不能穿过建筑。</p></section>
        <section><h2>战斗与抱抱请求</h2><p>面向敌人近身攻击；红色警戒圈出现后及时拉开距离躲避。击败敌人后，靠近掉落物按 E 拾取。</p>
          <p>扩音器怪物（失控广播员）擅长中距离压制，蓄力时喇叭红灯变亮并在地面标出红噪声波方向，最后 0.3 秒锁定方向后发射声波，可借横向走位或建筑掩体躲开；命中会造成 10 点伤害、2.5 秒减速 30% 与 3 秒耳鸣（环境声变闷）。电击器眩晕可打断其蓄力，也可抓住其发射后 1 秒硬直贴近反击。</p>
          <p>抱抱怪发出请求后，在 6 秒内靠近并停住，连续长按 Q 1.5 秒（手机长按抱抱按钮），可使原来的怪物平静约 30 秒，不产生物品奖励。首次有效攻击、请求超时或安抚中受伤会触发 1 秒橙色预警，随后变异追击；松键或移动会清空安抚进度，离开太远则取消请求。</p></section>
        <section><h2>思源密码线索</h2><p>在思源楼前打开固定宝箱取得本局残缺手记，携带手记前往明湖石碑调查并收取异常羽毛。成功撤离时同时带回本局手记与异常羽毛，即可解锁第一章。</p></section>
        <section><h2>操作</h2><dl class="rules-controls">
          <div><dt><kbd>W A S D</kbd> / 方向键</dt><dd>移动</dd></div>
          <div><dt>鼠标</dt><dd>进入探索即可转动视角；人物与手电朝向镜头前方。Esc 打开设置或继续探索，Tab 打开背包后可点击画面内按钮。</dd></div>
          <div><dt><kbd>Tab</kbd> / <kbd>Esc</kbd></dt><dd>背包 / 设置；背包不暂停，设置暂停</dd></div>
          <div><dt><kbd>E</kbd></dt><dd>搜索 / 拾取 / 调查 / 充电 / 撤离</dd></div>
          <div><dt><kbd>Q</kbd></dt><dd>安抚抱抱怪</dd></div>
          <div><dt><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></dt><dd>切换底部快捷栏道具，每格只放一件道具，同类道具分别占格，用完后该格变为空格。打开背包选中道具，点击“放入快捷栏”，再点击底部目标格或按对应数字即可替换；Esc 取消。被替换的道具仍留在背包。</dd></div>
          <div><dt>鼠标左键 / <kbd>Space</kbd></dt><dd>使用当前道具或近身攻击；手机点击快捷格选择，再按使用按钮。</dd></div>
          <div><dt><kbd>L</kbd> / <kbd>R</kbd> / <kbd>G</kbd></dt><dd>手电开关 / 换电池 / 放照明棒</dd></div>
        </dl><p>开始探索时会尝试进入全屏。支持的桌面浏览器中，短按 Esc 打开设置或继续探索，长按 Esc 可退出全屏；浏览器如询问键盘锁定权限，允许后即可使用。可在设置中点击“全屏”重新进入。手机页面始终按横屏排版；支持的浏览器会在开始探索时进入全屏并锁定横屏，不支持时自动旋转页面。可点击顶部“全屏”重试。左摇杆移动，右侧瞄准摇杆控制手电与攻击方向，松手后保留朝向；右侧按钮执行对应操作。顶部可查看价值、电量和设置；左下角点击背包图标管理物品，背包打开期间计时继续。局内打开设置、规则、校园图或图鉴会暂停计时与敌人行动，并中断当前读条；关闭后继续。刷新仍按失败处理。</p></section>
      </div>
      <footer class="rules-footer"><button id="rules-continue" class="primary">进入校园</button></footer>
    </dialog>`;
}

export function bindGameRules(onOpen: () => void, onClose: () => void): HTMLDialogElement {
  const dialog = document.querySelector<HTMLDialogElement>('#game-rules');
  if (!dialog) {
    throw new Error('Missing game rules dialog');
  }
  const open = () => {
    if (dialog.open) {
      return;
    }
    onOpen();
    const resume = document.getElementById('rules-continue');
    if (resume) {
      resume.textContent =
        document.getElementById('app')?.dataset.phase === 'preparing' ? '进入校园' : '继续探索';
    }
    dialog.showModal();
  };
  document.getElementById('open-rules')?.addEventListener('click', open);
  for (const id of ['close-rules', 'rules-continue']) {
    document.getElementById(id)?.addEventListener('click', () => dialog.close());
  }
  dialog.addEventListener('close', onClose);
  return dialog;
}
