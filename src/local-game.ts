import './style.css';
import './mobile-layout.css';
import { WAREHOUSE_CAPACITY } from './config/game-config';
import { startGame } from './game';

const originalFetch = window.fetch.bind(window);
const leaseToken = 'd'.repeat(64);
let revision = 0;
const previewLoot = [
  'bandage',
  'bandage',
  'morning-coffee',
  'portable-medkit',
  'yellow-bike',
  'thick-down-jacket',
  'hunter-binoculars',
  'silver-watch',
  'david-head-statue',
  'school-badge',
  'gpa-charm',
  'siyuan-key',
  'torn-notebook',
  'marked-campus-map',
  'complete-record',
  'anomalous-feather',
  'scratch-paper',
];

/** ?warehouse=full（满 100 格）或 roomy（90 格）：附带一封补发邮件，用来验收容量拦截与信箱领取 */
const probe = new URLSearchParams(location.search).get('warehouse');
const probeCount = probe === 'full' ? WAREHOUSE_CAPACITY : probe === 'roomy' ? 90 : 0;

const previewItem = (itemId: string, index: number, prefix = 'preview') => ({
  instanceId: `${prefix}-${index}`,
  itemId,
  origin: { kind: 'raid-loot' as const, obtainedInRaidId: 'preview-raid' },
});

let savedData: unknown = {
  schemaVersion: 4,
  warehouse:
    probeCount > 0
      ? Array.from({ length: probeCount }, (_, index) =>
          previewItem(previewLoot[index % previewLoot.length]!, index, 'probe'),
        )
      : previewLoot.map((itemId, index) => previewItem(itemId, index)),
  currency: 1280,
  codexIds: [...new Set(previewLoot)],
  unlockedChapterIds: [],
  activeRaid: null,
  settledRaidIds: [],
  lastResult: null,
  mailbox:
    probeCount > 0
      ? [
          {
            mailId: 'preview-mail',
            title: '物资补发',
            body: '仓库装不下的这 3 件物资暂时存放在思源信箱，腾出格子后再来领取。',
            createdAt: Date.now(),
            sourceRaidId: 'preview-raid',
            attachments: ['silver-watch', 'anomalous-feather', 'siyuan-key'].map((itemId, index) =>
              previewItem(itemId, index, 'mail'),
            ),
          },
        ]
      : [],
};
const leaseExpiresAt = () => Date.now() + 10 * 60 * 1000;

window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof Request ? input.url : input.href,
    location.href,
  );
  if (url.pathname === '/api/save/open') {
    return Response.json({
      data: savedData,
      revision,
      leaseToken,
      leaseExpiresAt: leaseExpiresAt(),
    });
  }
  if (url.pathname === '/api/save/heartbeat') {
    return Response.json({ leaseExpiresAt: leaseExpiresAt() });
  }
  if (url.pathname === '/api/save/release') return new Response(null, { status: 204 });
  if (url.pathname === '/api/save') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { revision?: number; data?: unknown };
    if (body.revision !== revision) {
      return Response.json({ message: '试玩存档版本不匹配。' }, { status: 409 });
    }
    savedData = body.data ?? null;
    revision += 1;
    // 试玩环境没有后端，用计数方便自动化脚本确认「改动确实写进了存档」
    (window as Window & { __saveWrites?: number }).__saveWrites =
      ((window as Window & { __saveWrites?: number }).__saveWrites ?? 0) + 1;
    return Response.json({ revision, leaseExpiresAt: leaseExpiresAt() });
  }
  return originalFetch(input, init);
};

void startGame(
  { id: 'd'.repeat(32), username: 'local-preview', displayName: '本地试玩者' },
  async () => undefined,
);
