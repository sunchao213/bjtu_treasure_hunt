import { describe, expect, it } from 'vitest';
import {
  NightCombat,
  NightLighting,
  LAMPS,
  lineOfSight,
} from '../../src/modules/world/night-systems';

const bounds = { x: 0, y: 0, width: 3600, height: 2400 };
const advance = (
  combat: NightCombat,
  player: { x: number; y: number },
  ms: number,
  held = false,
) => {
  let damage = 0;
  for (let t = 0; t < ms; t += 100) {
    damage += combat.update(100, player, true, held, true, [], bounds).damage;
  }
  return damage;
};

describe('night lighting', () => {
  it('reveals chests only within an active flashlight cone, even next to lamps or flares', () => {
    const light = new NightLighting();
    const player = { x: 100, y: 100 };
    expect(light.flashlightReveals({ x: 130, y: 100 }, player, 0, [])).toBe(true);
    expect(light.flashlightReveals({ x: 100, y: 130 }, player, 0, [])).toBe(false);
    expect(light.flashlightReveals({ x: 420, y: 100 }, player, 0, [])).toBe(false);
    expect(
      light.flashlightReveals({ x: 200, y: 100 }, player, 0, [
        { x: 140, y: 80, width: 20, height: 40 },
      ]),
    ).toBe(false);
    light.enabled = false;
    light.deploy(player);
    expect(light.illuminated(player, player, 0, [])).toBe(true);
    expect(light.flashlightReveals(player, player, 0, [])).toBe(false);
    expect(light.flashlightReveals(LAMPS[0]!, LAMPS[0]!, 0, [])).toBe(false);
    light.enabled = true;
    light.battery = 0;
    expect(light.flashlightReveals({ x: 130, y: 100 }, player, 0, [])).toBe(false);
  });
  it('clips visibility at walls and distinguishes ambient visibility from search light', () => {
    const light = new NightLighting();
    const player = { x: 100, y: 100 };
    const wall = [{ x: 130, y: 50, width: 20, height: 100 }];
    expect(light.visible({ x: 200, y: 100 }, player, 0, [])).toBe(true);
    expect(light.visible({ x: 200, y: 100 }, player, 0, wall)).toBe(false);
    expect(lineOfSight(player, { x: 200, y: 100 }, wall)).toBe(false);
    expect(light.visible({ x: 100, y: 250 }, player, 0, [])).toBe(false);
    light.toggle();
    expect(light.visible({ x: 120, y: 100 }, player, 0, [])).toBe(true);
    expect(light.illuminated({ x: 120, y: 100 }, player, 0, [])).toBe(false);
    expect(light.illuminated(LAMPS[0]!, player, 0, [])).toBe(true);
  });
  it('depletes, replaces, charges and resets batteries without a permanent softlock', () => {
    const light = new NightLighting();
    for (let i = 0; i < 1801; i++) {
      light.tick(100);
    }
    expect(light.battery).toBe(0);
    expect(light.enabled).toBe(false);
    light.toggle();
    expect(light.enabled).toBe(false);
    expect(light.refill()).toBe(true);
    expect(light.spareBatteries).toBe(1);
    light.battery = 1;
    expect(light.refill()).toBe(true);
    light.battery = 0;
    expect(light.refill()).toBe(false);
    light.charge();
    expect(light.battery).toBe(100);
    expect(light.spareBatteries).toBe(0);
    light.reset();
    expect(light.spareBatteries).toBe(2);
  });
  it('deploys two flares, expires them and resets their stock', () => {
    const light = new NightLighting();
    const point = { x: 100, y: 100 };
    light.toggle();
    expect(light.deploy(point)).toBe(true);
    expect(light.illuminated(point, point, 0, [])).toBe(true);
    expect(light.deploy(point)).toBe(true);
    expect(light.deploy(point)).toBe(false);
    for (let i = 0; i < 300; i++) {
      light.tick(100);
    }
    expect(light.flares).toHaveLength(0);
    expect(light.illuminated(point, point, 0, [])).toBe(false);
    light.reset();
    expect(light.flareCount).toBe(2);
  });
});

describe('night combat', () => {
  it('patrols, chases into reachable range, warns before attacking and damages', () => {
    const combat = new NightCombat();
    const enemy = combat.enemies[0]!;
    const original = { ...enemy.position };
    advance(combat, { x: 700, y: 850 }, 1000);
    expect(enemy.position).not.toEqual(original);
    const player = { x: enemy.position.x + 100, y: enemy.position.y };
    for (let i = 0; i < 20 && enemy.state !== 'windup'; i++) {
      advance(combat, player, 100);
    }
    expect(enemy.state).toBe('windup');
    expect(combat.invulnerability).toBe(0);
    expect(advance(combat, player, 500)).toBe(14);
    expect(advance(combat, player, 500)).toBe(0);
  });
  it('lets a player dodge a telegraphed strike', () => {
    const combat = new NightCombat();
    const enemy = combat.enemies[0]!;
    const player = { x: enemy.position.x + 40, y: enemy.position.y };
    advance(combat, player, 100);
    expect(enemy.state).toBe('windup');
    expect(advance(combat, { x: player.x + 100, y: player.y }, 500)).toBe(0);
  });
  it('blocks melee through walls, honors cooldown and returns a defeat only once', () => {
    const combat = new NightCombat();
    const enemy = combat.enemies[0]!;
    const player = { x: enemy.position.x - 60, y: enemy.position.y };
    const wall = [{ x: player.x + 20, y: player.y - 40, width: 10, height: 80 }];
    combat.attack(player, 0, wall, 35);
    expect(enemy.health).toBe(70);
    combat.tick(450);
    combat.attack(player, 0, [], 35);
    expect(enemy.health).toBe(35);
    combat.attack(player, 0, [], 35);
    expect(enemy.health).toBe(35);
    combat.tick(450);
    expect(combat.attack(player, 0, [], 35).map((e) => e.id)).toEqual([enemy.id]);
    combat.tick(450);
    expect(combat.attack(player, 0, [], 35)).toEqual([]);
    combat.reset();
    expect(combat.enemies[0]!.health).toBe(70);
    expect(combat.attackCooldown).toBe(0);
  });
  it('supports continuous hugs, cancels partial holds and calms only once', () => {
    const combat = new NightCombat();
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    const player = { x: hug.position.x + 30, y: hug.position.y };
    advance(combat, player, 700, true);
    expect(hug.hugProgress).toBe(700);
    advance(combat, player, 100, false);
    expect(hug.hugProgress).toBe(0);
    for (let i = 0; i < 14; i++) {
      combat.update(100, player, true, true, true, [], bounds);
    }
    expect(combat.update(100, player, true, true, true, [], bounds).calmed).toHaveLength(1);
    expect(hug.state).toBe('calmed');
    expect(combat.update(100, player, true, true, true, [], bounds).calmed).toHaveLength(0);
  });
  it('mutates after a request expires or a player attacks, and resets next raid', () => {
    const combat = new NightCombat();
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    advance(combat, { x: hug.position.x + 70, y: hug.position.y }, 6100);
    expect(hug.mutated).toBe(true);
    expect(hug.state).not.toBe('request');
    combat.reset();
    const fresh = combat.enemies.find((e) => e.kind === 'hug')!;
    expect(fresh.mutated).toBe(false);
    combat.attack({ x: fresh.position.x - 70, y: fresh.position.y }, 0, [], 35);
    expect(fresh.mutated).toBe(true);
  });
});
