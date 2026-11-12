import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldScene } from '../../src/scenes/world-scene';
import type { PlayerSnapshot } from '../../src/modules/network/network-protocol';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
afterEach(() => vi.unstubAllGlobals());

class DisplayObject {
  scene: object | null = {};
  visible = true;
  alpha = 1;
  name = '';
  x = 0;
  y = 0;
  displayHeight = 160;
  displayWidth = 80;
  list: DisplayObject[] = [];
  anims = {
    currentAnim: null as { key: string } | null,
    play: vi.fn((key: string) => {
      this.anims.currentAnim = { key };
    }),
  };
  setName(name: string) {
    this.name = name;
    return this;
  }
  setOrigin = vi.fn(() => this);
  setScale = vi.fn((scale: number) => {
    this.displayHeight = 160 * scale;
    return this;
  });
  setDepth = vi.fn(() => this);
  setResolution = vi.fn(() => this);
  setText = vi.fn(() => this);
  setPosition(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }
  setY(y: number) {
    this.y = y;
    return this;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    return this;
  }
  setAlpha(alpha: number) {
    this.alpha = alpha;
    return this;
  }
  destroy = vi.fn();
  getByName(name: string) {
    return this.list.find((child) => child.name === name);
  }
}

function setup() {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const scene = new WorldScene({
    network: { getPlayerId: () => 'self', getRoomState: () => null },
  } as unknown as ConstructorParameters<typeof WorldScene>[0]);
  const sprite = vi.fn(() => new DisplayObject());
  const text = vi.fn(() => new DisplayObject());
  Object.assign(scene, {
    cameras: { main: { zoom: 1.7 } },
    add: {
      sprite,
      text,
      ellipse: () => new DisplayObject(),
      container: (x: number, y: number, list: DisplayObject[]) =>
        Object.assign(new DisplayObject(), { x, y, list }),
    },
  });
  const players = Reflect.get(scene, 'remotePlayers') as Map<string, { object: DisplayObject }>;
  const update = (ms = 16) => Reflect.get(scene, 'updateRoomPlayers').call(scene, ms);
  return { scene, sprite, text, players, update };
}

const peer = (overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  playerId: 'peer',
  displayName: '队友昵称',
  position: { x: 100, y: 200 },
  aim: 0,
  health: 100,
  connected: true,
  ready: true,
  finished: false,
  ...overrides,
});

describe('room player presentation', () => {
  it('keeps nearby nicknames readable and removes labels for destroyed players', () => {
    const s = setup();
    s.scene.syncRemotePlayers([peer(), peer({ playerId: 'other' }), peer({ playerId: 'third' })]);
    const sync = () => Reflect.get(s.scene, 'syncNameplates').call(s.scene);
    sync();
    const labels = s.text.mock.results.map((result) => result.value);
    expect(labels[1]!.y).toBeLessThan(labels[0]!.y - labels[0]!.displayHeight);
    expect(labels[2]!.y).toBeLessThan(labels[1]!.y - labels[1]!.displayHeight);
    s.players.get('other')!.object.x += 300;
    sync();
    expect(labels[1]!.y).toBe(labels[0]!.y);
    s.players.get('other')!.object.scene = null;
    sync();
    expect(labels[1]!.destroy).toHaveBeenCalledOnce();
  });
  it('uses the local character sprite and overhead nickname for peers, excluding self', () => {
    const s = setup();
    s.scene.syncRemotePlayers([peer({ playerId: 'self' }), peer()]);
    expect(s.players.size).toBe(1);
    expect(s.sprite).toHaveBeenCalledWith(0, 0, 'player-idle', 0);
    const sprite = s.sprite.mock.results[0]!.value;
    expect(sprite.setOrigin).toHaveBeenCalledWith(0.5, 1);
    expect(sprite.setScale).toHaveBeenCalledWith(0.44);
    expect(s.text).toHaveBeenCalledWith(100, 200 - 160 * 0.44 - 6, '队友昵称', expect.any(Object));
    expect(sprite.anims.currentAnim?.key).toBe('player-idle-right');
  });

  it('walks smoothly toward network positions, turns with aim, and returns to idle without restarting every frame', () => {
    const s = setup();
    s.scene.syncRemotePlayers([peer()]);
    const object = s.players.get('peer')!.object;
    const sprite = object.getByName('sprite')!;
    s.scene.syncRemotePlayers([peer({ position: { x: 140, y: 200 }, aim: -Math.PI / 2 })]);
    s.update();
    expect(object.x).toBeGreaterThan(100);
    expect(object.x).toBeLessThan(140);
    expect(sprite.anims.currentAnim?.key).toBe('player-walk-up');
    s.update();
    expect(sprite.anims.play).toHaveBeenCalledTimes(2);
    for (let frame = 0; frame < 40; frame++) s.update();
    expect(sprite.anims.currentAnim?.key).toBe('player-idle-up');
    expect(sprite.anims.play).toHaveBeenCalledTimes(3);
    expect(s.sprite).toHaveBeenCalledTimes(1);
  });

  it('updates nicknames and removes disconnected or departed teammates', () => {
    const s = setup();
    s.scene.syncRemotePlayers([peer(), peer({ playerId: 'other' })]);
    const first = s.players.get('peer')!.object;
    const other = s.players.get('other')!.object;
    s.scene.syncRemotePlayers([
      peer({ displayName: '新昵称' }),
      peer({ playerId: 'other', connected: false }),
    ]);
    expect(s.text.mock.results[0]!.value.setText).toHaveBeenCalledWith('新昵称');
    expect(other.destroy).toHaveBeenCalledOnce();
    s.scene.removeRemotePlayer('peer');
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(s.players.size).toBe(0);
  });
});
