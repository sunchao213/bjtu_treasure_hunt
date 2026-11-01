import './auth.css';
import { AuthClient, startAuthenticated, type AuthSession } from './modules/auth/auth-client';

const root = document.getElementById('app')!;
const client = new AuthClient();
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bjtu-auth');
let playing = false;
let checking = false;
let observed: AuthSession | null = null;
let monitor: ReturnType<typeof setInterval> | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;

const reload = () => location.reload();
// A restored back/forward page must revalidate instead of reviving an old game session.
const onPageShow = (event: PageTransitionEvent) => {
  if (event.persisted) reload();
};
window.addEventListener('pageshow', onPageShow);
channel?.addEventListener('message', reload);
window.addEventListener('pagehide', () => {
  channel?.close();
  clearInterval(monitor);
  clearTimeout(expiry);
});

function frame(content: string): void {
  root.innerHTML = `<main class="auth-page"><section class="auth-story" aria-label="游戏介绍">
    <a class="auth-brand" href="./"><span>交</span>交大摸金录</a>
    <p class="auth-eyebrow">思源密码 · CAMPUS EXTRACTION</p>
    <h1>夜幕降临，<br>校园的故事等你发现。</h1>
    <p>寻找散落的校园记忆，带着收获平安归来。<br>登录后，开启你的下一次探索。</p>
    <div class="auth-landmark" aria-hidden="true">知行 · 明湖 · 思源</div>
  </section><section class="auth-card" aria-label="账号登录">${content}</section></main>`;
}

function loading(): void {
  frame(
    '<p class="auth-eyebrow">EXPLORER ACCESS</p><h2>正在验证登录状态</h2><p role="status">验证通过后加载游戏，请稍候…</p>',
  );
}

async function logout(): Promise<void> {
  await client.logout();
  channel?.postMessage('session-changed');
  reload();
}

async function verifyPlayingSession(): Promise<void> {
  if (!playing || checking) return;
  checking = true;
  try {
    const session = await client.current();
    if (!session || session.user.id !== observed?.user.id) reload();
  } catch {
    // Stop gameplay if authentication can no longer be verified. Reload tears down every game system.
    reload();
  } finally {
    checking = false;
  }
}

async function enterGame(): Promise<boolean> {
  return startAuthenticated(
    { current: async () => (observed = await client.current()) },
    async () => {
      const { startGame } = await import('./game');
      return async (user) => {
        playing = true;
        expiry = setTimeout(reload, Math.max(0, Date.parse(observed!.expiresAt) - Date.now()));
        monitor = setInterval(() => void verifyPlayingSession(), 30_000);
        await startGame(user, logout);
      };
    },
  );
}

const onFocus = () => void verifyPlayingSession();
const onVisibility = () => {
  if (!document.hidden) void verifyPlayingSession();
};
window.addEventListener('focus', onFocus);
document.addEventListener('visibilitychange', onVisibility);

function showLogin(message = ''): void {
  frame(`<p class="auth-eyebrow">EXPLORER ACCESS</p><h2 id="auth-title">欢迎回来</h2>
    <p id="auth-intro">登录账号，继续你的校园探索。</p>
    <div class="auth-tabs" role="group" aria-label="选择账号操作">
      <button id="tab-login" type="button" aria-pressed="true">登录</button>
      <button id="tab-register" type="button" aria-pressed="false">注册账号</button>
    </div>
    <form id="auth-form"><fieldset id="auth-fields">
      <label for="auth-username">用户名</label>
      <input id="auth-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" aria-describedby="username-help" placeholder="输入用户名">
      <small id="username-help">3–24 位字母、数字或下划线，不区分大小写</small>
      <div id="register-name" hidden><label for="auth-name">游戏昵称</label>
        <input id="auth-name" name="displayName" autocomplete="nickname" maxlength="18" placeholder="联机时展示的名字" disabled></div>
      <label for="auth-password">密码</label>
      <div class="auth-password"><input id="auth-password" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required placeholder="输入 8–128 位密码"><button id="show-password" type="button" aria-label="显示密码" aria-pressed="false">显示</button></div>
      <div id="register-confirm" hidden><label for="auth-confirm">确认密码</label>
        <input id="auth-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" disabled placeholder="再次输入密码"></div>
      <p id="auth-message" class="auth-message" role="status" aria-live="polite"></p>
      <button id="auth-submit" class="auth-primary" type="submit">登录并进入游戏</button>
    </fieldset></form>
    <button id="auth-retry" type="button" class="auth-retry">重新检查登录状态</button>
    <p class="auth-footnote">登录状态保留 12 小时。仓库、图鉴和任务进度按账号保存到云端，可在不同设备继续探索。</p>`);
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const form = get<HTMLFormElement>('auth-form');
  const fields = get<HTMLFieldSetElement>('auth-fields');
  const password = get<HTMLInputElement>('auth-password');
  const confirmation = get<HTMLInputElement>('auth-confirm');
  const name = get<HTMLInputElement>('auth-name');
  const status = get('auth-message');
  const submit = get<HTMLButtonElement>('auth-submit');
  let mode: 'login' | 'register' = 'login';
  let busy = false;
  status.textContent = message;
  get('auth-retry').onclick = () => {
    if (!busy) restore();
  };

  const selectMode = (next: typeof mode) => {
    if (busy) return;
    mode = next;
    const register = mode === 'register';
    get('tab-login').setAttribute('aria-pressed', String(!register));
    get('tab-register').setAttribute('aria-pressed', String(register));
    get('register-name').hidden = !register;
    get('register-confirm').hidden = !register;
    name.disabled = confirmation.disabled = !register;
    name.required = confirmation.required = register;
    confirmation.setCustomValidity('');
    password.autocomplete = register ? 'new-password' : 'current-password';
    get('auth-title').textContent = register ? '成为校园探索者' : '欢迎回来';
    get('auth-intro').textContent = register
      ? '创建账号，启程寻找你的第一份校园记忆。'
      : '登录账号，继续你的校园探索。';
    submit.textContent = register ? '创建账号并进入游戏' : '登录并进入游戏';
    status.textContent = '';
  };
  get('tab-login').onclick = () => selectMode('login');
  get('tab-register').onclick = () => selectMode('register');
  get('show-password').onclick = () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    get('show-password').textContent = show ? '隐藏' : '显示';
    get('show-password').setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    get('show-password').setAttribute('aria-pressed', String(show));
  };
  const validateConfirmation = () => {
    confirmation.setCustomValidity(
      mode === 'register' && password.value !== confirmation.value ? '两次输入的密码不一致。' : '',
    );
  };
  confirmation.oninput = password.oninput = validateConfirmation;
  form.onsubmit = async (event) => {
    event.preventDefault();
    validateConfirmation();
    if (busy || !form.reportValidity()) return;
    busy = true;
    fields.disabled = true;
    status.textContent = mode === 'register' ? '正在创建账号…' : '正在登录…';
    try {
      await client.submit(
        mode,
        get<HTMLInputElement>('auth-username').value.trim(),
        password.value,
        name.value.trim(),
      );
      password.value = confirmation.value = '';
      channel?.postMessage('session-changed');
      status.textContent = '登录成功，正在加载游戏…';
      if (!(await enterGame())) showLogin('登录状态已变化，请重新登录。');
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '登录失败，请重试。';
    } finally {
      busy = false;
      fields.disabled = false;
    }
  };
}

function restore(): void {
  loading();
  void enterGame()
    .then((started) => {
      if (!started) showLogin();
    })
    .catch((error: unknown) => {
      // No guest fallback: an unavailable backend must never start the game.
      showLogin(error instanceof Error ? error.message : '无法验证登录状态，请重试。');
    });
}
restore();

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    clearInterval(monitor);
    clearTimeout(expiry);
    channel?.close();
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
  });
