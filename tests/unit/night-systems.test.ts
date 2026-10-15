import { describe, expect, it } from 'vitest';
import {
  NightCombat,
  NightLighting,
  LAMPS,
  findEnemySpawnPosition,
  lineOfSight,
  shouldDropPatrolLoot,
} from '../../src/modules/world/night-systems';
import { COMBAT_RULES } from '../../src/config/combat-config';
import { WORLD } from '../../src/config/world-config';

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
  it('randomizes initial monster positions across the map while keeping them separated', () => {
    let randomCalls = 0;
    const firstRaid = new NightCombat(() => (randomCalls++ * 0.37) % 1);
    const secondRaid = new NightCombat(() => 0.25);
    expect(firstRaid.enemies).toHaveLength(secondRaid.enemies.length);
    expect(firstRaid.enemies.map((enemy) => enemy.position)).not.toEqual(
      secondRaid.enemies.map((enemy) => enemy.position),
    );
    for (const enemy of firstRaid.enemies) {
      expect(enemy.position).toEqual(enemy.route[0]);
      expect(enemy.home).toEqual(enemy.position);
      expect(enemy.position.x).toBeGreaterThanOrEqual(45 + 18);
      expect(enemy.position.x).toBeLessThanOrEqual(WORLD.width - 45 - 18);
      expect(enemy.position.y).toBeGreaterThanOrEqual(50 + 18);
      expect(enemy.position.y).toBeLessThanOrEqual(WORLD.height - 50 - 18);
      expect(enemy.wanders).toBe(enemy.kind === 'patrol');
    }
    for (let i = 0; i < firstRaid.enemies.length; i++) {
      for (let j = i + 1; j < firstRaid.enemies.length; j++) {
        expect(
          Math.hypot(
            firstRaid.enemies[i]!.position.x - firstRaid.enemies[j]!.position.x,
            firstRaid.enemies[i]!.position.y - firstRaid.enemies[j]!.position.y,
          ),
        ).toBeGreaterThanOrEqual(COMBAT_RULES.spawning.minEnemyDistance);
      }
    }

    const previousPositions = firstRaid.enemies.map((enemy) => ({ ...enemy.position }));
    firstRaid.reset();
    expect(firstRaid.enemies.map((enemy) => enemy.position)).not.toEqual(previousPositions);
  });

  it('uses a 40 percent drop chance for patrol monster loot', () => {
    expect(shouldDropPatrolLoot(() => 0.3999)).toBe(true);
    expect(shouldDropPatrolLoot(() => 0.4)).toBe(false);
  });

  it('spawns after a random interval and caps the number of active enemies', () => {
    const combat = new NightCombat(() => 0);
    let positionIndex = 0;
    const findPosition = () => ({ x: 100 + positionIndex++ * 140, y: 150 });
    expect(combat.updateSpawns(COMBAT_RULES.spawning.intervalMinMs - 1, findPosition)).toHaveLength(
      0,
    );
    const firstWave = combat.updateSpawns(1, findPosition);
    expect(firstWave).toHaveLength(COMBAT_RULES.spawning.spawnCount);
    expect(firstWave.every((enemy) => enemy.kind === 'patrol')).toBe(true);
    expect(firstWave.every((enemy) => enemy.route.length === 1 && enemy.wanders)).toBe(true);
    for (const enemy of firstWave) {
      expect(enemy.route[0]).not.toEqual(enemy.position);
      expect(
        Math.hypot(enemy.route[0]!.x - enemy.position.x, enemy.route[0]!.y - enemy.position.y),
      ).toBeLessThanOrEqual(480);
      expect(
        Math.hypot(enemy.route[0]!.x - enemy.position.x, enemy.route[0]!.y - enemy.position.y),
      ).toBeGreaterThanOrEqual(140);
      expect(lineOfSight(enemy.position, enemy.route[0]!, [])).toBe(true);
    }
    const firstTarget = { ...firstWave[0]!.route[0]! };
    advance(combat, { x: 900, y: 850 }, 3_000);
    expect(firstWave[0]!.route[0]).not.toEqual(firstTarget);
    expect(
      Math.hypot(
        firstWave[0]!.route[0]!.x - firstTarget.x,
        firstWave[0]!.route[0]!.y - firstTarget.y,
      ),
    ).toBeLessThanOrEqual(480);
    expect(
      Math.hypot(
        firstWave[0]!.route[0]!.x - firstWave[0]!.home.x,
        firstWave[0]!.route[0]!.y - firstWave[0]!.home.y,
      ),
    ).toBeLessThanOrEqual(480);
    expect(combat.enemies).toHaveLength(WORLD.enemyRoutes.length + firstWave.length);

    const secondWave = combat.updateSpawns(100_000, findPosition);
    expect(secondWave).toHaveLength(COMBAT_RULES.spawning.spawnCount + 1);
    expect(secondWave.filter((enemy) => enemy.kind === 'patrol')).toHaveLength(
      COMBAT_RULES.spawning.spawnCount,
    );
    expect(secondWave.filter((enemy) => enemy.kind === 'hug')).toHaveLength(1);
    expect(combat.enemies.filter((enemy) => enemy.state !== 'dead')).toHaveLength(
      WORLD.enemyRoutes.length + firstWave.length + secondWave.length,
    );
  });

  it('chooses spawn positions outside view, away from the player and extraction', () => {
    const lighting = new NightLighting();
    const player = { x: 625, y: 800 };
    const candidates = [(300 - 45) / (WORLD.width - 90), (160 - 50) / (WORLD.height - 100)];
    let index = 0;
    const point = findEnemySpawnPosition(
      player,
      -Math.PI / 2,
      lighting,
      [],
      () => candidates[index++]!,
    );
    expect(point?.x).toBeCloseTo(300);
    expect(point?.y).toBeCloseTo(160);
    expect(lighting.visible(point!, player, -Math.PI / 2, [])).toBe(false);
  });

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
    expect(combat.attackHit).toBe(false);
    combat.tick(450);
    combat.attack(player, 0, [], 35);
    expect(enemy.health).toBe(35);
    expect(combat.attackHit).toBe(true);
    combat.attack(player, 0, [], 35);
    expect(enemy.health).toBe(35);
    expect(combat.attackHit).toBe(false);
    combat.tick(450);
    expect(combat.attack(player, 0, [], 35).map((e) => e.id)).toEqual([enemy.id]);
    combat.tick(450);
    expect(combat.attack(player, 0, [], 35)).toEqual([]);
    combat.reset();
    expect(combat.enemies[0]!.health).toBe(70);
    expect(combat.attackCooldown).toBe(0);
  });
  it('uses a stun baton fifteen times with its shorter range, narrow arc and stun duration', () => {
    const combat = new NightCombat();
    const enemy = combat.enemies[0]!;
    const player = { x: enemy.position.x - 70, y: enemy.position.y };
    combat.attack(player, 0, [], 15, 'stun-baton');
    expect(enemy.health).toBe(55);
    expect(enemy.state).toBe('stunned');
    expect(enemy.timer).toBe(1_200);
    expect(combat.weaponUsesRemaining).toBe(14);

    for (let i = 0; i < 12; i++)
      combat.update(100, { x: 900, y: 850 }, true, false, true, [], bounds);
    expect(enemy.state).toBe('chase');

    combat.tick(1_200);
    combat.attack(player, 0, [], 15, 'stun-baton');
    expect(enemy.health).toBe(40);
    expect(combat.weaponUsesRemaining).toBe(13);
    combat.tick(1_200);
    combat.attack(player, 0, [], 15, 'stun-baton');
    expect(enemy.health).toBe(25);
    expect(combat.weaponUsesRemaining).toBe(12);
    combat.tick(1_200);
    for (let i = 0; i < 11; i++) {
      combat.attack(player, 0, [], 15, 'stun-baton');
      combat.tick(1_200);
    }
    expect(combat.weaponUsesRemaining).toBe(1);
    combat.attack(player, 0, [], 15, 'stun-baton');
    expect(combat.weaponUsesRemaining).toBe(0);
    combat.tick(1_200);
    combat.attack(player, 0, [], 15, 'stun-baton');
    expect(combat.attackHit).toBe(false);
    expect(combat.weaponUsesRemaining).toBe(0);

    const narrow = new NightCombat();
    const target = narrow.enemies[0]!;
    const narrowPlayer = { x: target.position.x - 70, y: target.position.y };
    narrow.attack(narrowPlayer, Math.PI / 2, [], 15, 'stun-baton');
    expect(narrow.attackHit).toBe(false);
    expect(target.health).toBe(70);
  });
  it('stuns mutated enemies for 600ms and respects the 75-unit attack range', () => {
    const combat = new NightCombat();
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    hug.mutated = true;
    hug.state = 'chase';
    const player = { x: hug.position.x - 80, y: hug.position.y };
    combat.attack(player, 0, [], 15, 'stun-baton');
    expect(combat.attackHit).toBe(false);
    expect(hug.health).toBe(100);
    combat.tick(1_200);
    player.x = hug.position.x - 70;
    combat.attack(player, 0, [], 15, 'stun-baton');
    expect(hug.health).toBe(85);
    expect(hug.state).toBe('stunned');
    expect(hug.timer).toBe(600);
    for (let i = 0; i < 6; i++)
      combat.update(100, { x: 900, y: 850 }, true, false, true, [], bounds);
    expect(hug.state).toBe('chase');
  });
  it('follows during a hug request, supports continuous hugs and calms only once', () => {
    const combat = new NightCombat();
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    const player = { x: hug.position.x + 100, y: hug.position.y };
    const original = { ...hug.position };
    advance(combat, player, 700, true);
    expect(hug.hugProgress).toBe(700);
    expect(hug.position).not.toEqual(original);
    advance(combat, player, 100, false);
    expect(hug.hugProgress).toBe(0);
    for (let i = 0; i < 14; i++) {
      combat.update(100, player, true, true, true, [], bounds);
    }
    expect(combat.update(100, player, true, true, true, [], bounds).calmed).toHaveLength(1);
    expect(hug.state).toBe('calmed');
    expect(combat.update(100, player, true, true, true, [], bounds).calmed).toHaveLength(0);
    advance(combat, player, 29_800, true);
    expect(hug.state).toBe('calmed');
    advance(combat, player, 100, true);
    expect(hug.state).toBe('patrol');
    expect(hug.mutated).toBe(false);
  });
  it('mutates after a 6 second request expires or after two calm-state hits', () => {
    const combat = new NightCombat();
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    advance(combat, { x: hug.position.x + 70, y: hug.position.y }, 6_100);
    expect(hug.mutated).toBe(true);
    expect(hug.state).not.toBe('request');
    combat.reset();
    const fresh = combat.enemies.find((e) => e.kind === 'hug')!;
    expect(fresh.mutated).toBe(false);
    const player = { x: fresh.position.x + 30, y: fresh.position.y };
    advance(combat, player, 1_500, true);
    expect(fresh.state).toBe('calmed');
    combat.attack(player, Math.PI, [], 35);
    expect(fresh.state).toBe('calmed');
    combat.tick(450);
    combat.attack(player, Math.PI, [], 35);
    expect(fresh.mutated).toBe(true);
    expect(fresh.health).toBe(COMBAT_RULES.hug.health);
  });

  it('does not mutate a peaceful patrol hug monster on the first hit and restores full health on the second', () => {
    const combat = new NightCombat();
    const hug = combat.enemies.find((enemy) => enemy.kind === 'hug')!;
    const player = { x: hug.position.x + 30, y: hug.position.y };

    combat.attack(player, Math.PI, [], 35);
    expect(hug.mutated).toBe(false);
    expect(hug.state).toBe('patrol');
    expect(hug.health).toBe(COMBAT_RULES.hug.health - 35);

    combat.tick(450);
    combat.attack(player, Math.PI, [], 35);
    expect(hug.mutated).toBe(true);
    expect(hug.state).toBe('chase');
    expect(hug.health).toBe(COMBAT_RULES.hug.health);
  });

  it('counts electric shocks against a calm hug monster as two hits to mutate', () => {
    const combat = new NightCombat();
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    const player = { x: hug.position.x + 30, y: hug.position.y };
    advance(combat, player, 1_500, true);
    expect(hug.state).toBe('calmed');
    combat.attack(player, Math.PI, [], 15, 'stun-baton');
    expect(hug.state).toBe('calmed');
    expect(hug.calmHitCount).toBe(1);
    combat.tick(1_200);
    combat.attack(player, Math.PI, [], 15, 'stun-baton');
    expect(hug.mutated).toBe(true);
    expect(hug.state).toBe('chase');
    expect(hug.calmHitCount).toBe(0);
  });

  it('loses a hug target when the player escapes instead of mutating', () => {
    const combat = new NightCombat();
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    const near = { x: hug.position.x + 30, y: hug.position.y };
    advance(combat, near, 100);
    expect(hug.state).toBe('request');
    advance(combat, { x: hug.position.x + 450, y: hug.position.y }, 100);
    expect(hug.state).toBe('patrol');
    expect(hug.mutated).toBe(false);
  });

  it('detects a mutated hug monster from an expanded chase range', () => {
    const combat = new NightCombat();
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    hug.mutated = true;
    const player = { x: hug.position.x + 280, y: hug.position.y };
    combat.update(100, player, true, false, true, [], bounds);
    expect(hug.state).toBe('chase');
  });

  it('lets a calm hug monster request attention beyond the mutated patrol detection range', () => {
    const combat = new NightCombat();
    const hug = combat.enemies.find((enemy) => enemy.kind === 'hug')!;
    const player = { x: hug.position.x + 290, y: hug.position.y };
    combat.update(100, player, true, false, true, [], bounds);
    expect(hug.state).toBe('request');
  });

  it('gives the hug monster a follow speed above a regular patrol monster chase speed', () => {
    expect(COMBAT_RULES.hug.followSpeed).toBeGreaterThan(COMBAT_RULES.enemy.patrol.chaseSpeed);
  });

  it('slows and enlarges a mutated hug monster compared with its previous mutated settings', () => {
    expect(COMBAT_RULES.hug.mutatedSpeed).toBeLessThan(COMBAT_RULES.enemy.mutated.speed);
    expect(COMBAT_RULES.hug.mutatedCollisionRadius).toBeGreaterThan(12);
  });
});
