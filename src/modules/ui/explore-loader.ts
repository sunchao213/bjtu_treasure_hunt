import { assetUrl } from '../../app/asset-url';

/**
 * 「开始探索」的过场加载动画（D · F01）。
 *
 * 职责只有一件：在准备页与局内地图之间盖一层全屏视频，播完淡出。
 * 不读存档、不改对局状态——暂停 / 恢复对局由调用方负责，否则这 5 秒里
 * 计时在走、怪物在动，玩家却看不见也动不了。
 *
 * 时序约定：
 *   play()  立即显示，并在点击手势内起播（浏览器只允许手势内自动播放）；
 *   hide()  请求收场，动画播完才淡出，开局加载慢时不会被硬切；
 *   cancel() 立即淡出，用于开局失败要马上退回准备页的情况。
 * play() 返回的 Promise 在遮罩真正淡出时 resolve，调用方可以据此恢复对局。
 */

/** 素材 10.1 秒，2 倍速约 5 秒；留出淡出与首帧解码的余量。 */
const PLAYBACK_RATE = 2;
/** 最短展示时间：加载再快也别闪一下就走。 */
const MIN_VISIBLE_MS = 1200;
/** 兜底上限：宁可提前切进地图，也不能把玩家焊在加载页上。 */
const MAX_VISIBLE_MS = 7000;
/** 与 CSS 的 opacity 过渡时长一致，避免过渡被裁断。 */
const LEAVE_MS = 380;

export interface ExploreLoader {
  /** 显示并播放；Promise 在遮罩淡出后 resolve。 */
  play(): Promise<void>;
  /** 请求收场：动画播完（或已经播完）就淡出。 */
  hide(): void;
  /** 立即淡出，不等动画播完。 */
  cancel(): void;
  /** 遮罩是否仍盖在屏幕上（含淡出中）；对局的暂停 / 恢复要据此让路。 */
  isShowing(): boolean;
}

type State = 'idle' | 'showing' | 'leaving';

export function createExploreLoader(): ExploreLoader {
  const root = document.createElement('div');
  root.className = 'explore-loader';
  root.hidden = true;
  root.setAttribute('role', 'status');

  const video = document.createElement('video');
  video.className = 'explore-loader-video';
  video.src = assetUrl('assets/ui/explore-loading.mp4');
  video.preload = 'auto';
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  // 三个属性都要显式写上：iOS 缺 playsinline 会把视频抢成全屏播放器。
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');

  const fallback = document.createElement('div');
  fallback.className = 'explore-loader-fallback';
  fallback.setAttribute('aria-hidden', 'true');
  const ring = document.createElement('span');
  ring.className = 'explore-loader-ring';
  const caption = document.createElement('p');
  caption.className = 'explore-loader-text';
  caption.textContent = '正在进入校园';
  fallback.append(ring, caption);

  const spoken = document.createElement('p');
  spoken.className = 'explore-loader-sr';
  spoken.textContent = '正在进入校园，请稍候。';

  // 元素一次建好并挂在 body 上，preload 从这一秒就开始，点击时才不会白屏。
  root.append(video, fallback, spoken);
  document.body.append(root);

  let state: State = 'idle';
  let animationDone = false;
  let leaveRequested = false;
  let shownAt = 0;
  let settleTimer = 0;
  let maxTimer = 0;
  let resolvePending: (() => void) | null = null;

  /** 真正淡出：这一步之后遮罩不再遮挡任何东西，对局可以恢复了。 */
  const finish = (): void => {
    if (state !== 'showing') {
      return;
    }
    state = 'leaving';
    window.clearTimeout(settleTimer);
    window.clearTimeout(maxTimer);
    root.classList.add('is-leaving');
    const resolve = resolvePending;
    resolvePending = null;
    window.setTimeout(() => {
      if (state !== 'leaving') {
        return;
      }
      state = 'idle';
      root.hidden = true;
      root.classList.remove('is-leaving');
      video.pause();
    }, LEAVE_MS);
    resolve?.();
  };

  /** 动画已经播完，也要等满最短展示时间再走。 */
  const finishAfterMinimum = (): void => {
    const remain = MIN_VISIBLE_MS - (performance.now() - shownAt);
    if (remain > 0) {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(finish, remain);
      return;
    }
    finish();
  };

  /** 视频播完、解码失败、或到兜底时限，三条路都汇到这里。 */
  const requestLeave = (): void => {
    if (state !== 'showing') {
      return;
    }
    animationDone = true;
    if (!leaveRequested) {
      return;
    }
    finishAfterMinimum();
  };

  /** 编码不被支持（例如没装 HEVC 扩展的 Chrome）时退回纯 CSS 进度环，绝不黑屏。 */
  const useFallback = (): void => {
    if (state === 'idle' || root.classList.contains('is-fallback')) {
      return;
    }
    root.classList.add('is-fallback');
    video.pause();
    requestLeave();
  };

  video.addEventListener('ended', requestLeave);
  video.addEventListener('error', useFallback);

  const play = (): Promise<void> => {
    return new Promise<void>((resolve) => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(maxTimer);
      // 上一轮若还没收场，先放它走，避免调用方永远等不到 resolve。
      const previous = resolvePending;
      previous?.();
      resolvePending = resolve;
      state = 'showing';
      animationDone = false;
      leaveRequested = false;
      shownAt = performance.now();
      root.hidden = false;
      root.classList.remove('is-leaving', 'is-fallback');
      video.playbackRate = PLAYBACK_RATE;
      try {
        video.currentTime = 0;
      } catch {
        // 元数据未就绪时赋值会抛错；src 加载完会从头播，忽略即可。
      }
      try {
        const attempt = video.play();
        // 部分旧版 Safari 的 play() 不返回 Promise。
        if (attempt) {
          void attempt.catch(useFallback);
        }
      } catch {
        useFallback();
      }
      maxTimer = window.setTimeout(() => {
        leaveRequested = true;
        finish();
      }, MAX_VISIBLE_MS);
    });
  };

  const hide = (): void => {
    if (state !== 'showing') {
      return;
    }
    leaveRequested = true;
    if (animationDone) {
      finishAfterMinimum();
    }
  };

  const cancel = (): void => {
    if (state !== 'showing') {
      return;
    }
    leaveRequested = true;
    animationDone = true;
    finish();
  };

  return { play, hide, cancel, isShowing: () => state !== 'idle' };
}
