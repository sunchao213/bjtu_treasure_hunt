import { describe, expect, it } from 'vitest';
import {
  NightCombat,
  NightLighting,
  LAMPS,
  encounterRegionKey,
  findEnemySpawnPosition,
  lineOfSight,
  shouldDropPatrolLoot,
} from '../../src/modules/world/night-systems';
import { COMBAT_RULES } from '../../src/config/combat-config';
import WORLD from '../../src/config/formal-campus.json';

const bounds = { x: 0, y: 0, width: 3600, height: 2400 };
// Behavior tests control position and isolate one enemy; spawning has separate tests.
function isolatedCombat(kind: 'patrol' | 'hug' | 'amplifier' = 'patrol'): NightCombat {
  const combat = new NightCombat(() => 0.5);
  const enemy = combat.enemies.find((entry) => entry.kind === kind)!;
  enemy.position = { x: 1000, y: 1000 };
  enemy.home = { ...enemy.position };
  enemy.route = [{ x: 1200, y: 1000 }];
  combat.enemies = [enemy];
  return combat;
}
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
    const light = new NightLighting(LAMPS);
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
  it('extends the flashlight search range for a reflective filter and resets it', () => {
    const light = new NightLighting();
    const player = { x: 100, y: 100 };
    expect(light.flashlightRange()).toBe(310);
    expect(light.flashlightReveals({ x: 450, y: 100 }, player, 0, [])).toBe(false);
    expect(light.setFlashlightRangeMultiplier(1.2)).toBe(true);
    expect(light.flashlightRange()).toBe(372);
    expect(light.flashlightReveals({ x: 450, y: 100 }, player, 0, [])).toBe(true);
    expect(light.setFlashlightRangeMultiplier(1.2)).toBe(false);
    light.reset();
    expect(light.flashlightRange()).toBe(310);
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
      expect(enemy.wanders).toBe(enemy.kind === 'patrol' || enemy.kind === 'amplifier');
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
    expect(firstWave.map((enemy) => enemy.species)).toEqual(['duck', 'cat', 'swan', 'duck']);
    expect(new Set(firstWave.map((enemy) => enemy.health))).toEqual(
      new Set([COMBAT_RULES.enemy.patrol.health]),
    );
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

    const availableSlots = COMBAT_RULES.spawning.maxAlive - combat.enemies.length;
    const expectedPatrols = Math.min(COMBAT_RULES.spawning.spawnCount, availableSlots);
    const expectedHugs = Math.min(1, availableSlots - expectedPatrols);
    const aliveAmplifiers = combat.enemies.filter(
      (enemy) => enemy.kind === 'amplifier' && enemy.state !== 'dead',
    ).length;
    const expectedAmplifiers = Math.min(
      Math.max(0, COMBAT_RULES.enemy.amplifier.maxAlive - aliveAmplifiers),
      Math.max(0, availableSlots - expectedPatrols - expectedHugs),
    );
    const secondWave = combat.updateSpawns(COMBAT_RULES.spawning.hugSpawnIntervalMs, findPosition);
    expect(secondWave).toHaveLength(expectedPatrols + expectedHugs + expectedAmplifiers);
    expect(secondWave.filter((enemy) => enemy.kind === 'patrol')).toHaveLength(expectedPatrols);
    expect(secondWave.filter((enemy) => enemy.kind === 'hug')).toHaveLength(expectedHugs);
    expect(secondWave.filter((enemy) => enemy.kind === 'amplifier')).toHaveLength(
      expectedAmplifiers,
    );
    expect(combat.enemies.filter((enemy) => enemy.state !== 'dead')).toHaveLength(
      WORLD.enemyRoutes.length + firstWave.length + secondWave.length,
    );
  });

  it('spawns a hug monster on its own timer when capacity is available', () => {
    const combat = new NightCombat(() => 0);
    combat.enemies = [];
    const findPosition = () => ({ x: 100, y: 150 });
    const rules = COMBAT_RULES.spawning;
    for (let elapsed = 0; elapsed < rules.hugSpawnIntervalMs - 1;) {
      const step = Math.min(rules.intervalMinMs, rules.hugSpawnIntervalMs - 1 - elapsed);
      expect(
        combat
          .updateSpawns(step, findPosition)
          .every((enemy) => enemy.kind === 'patrol' || enemy.kind === 'amplifier'),
      ).toBe(true);
      elapsed += step;
    }
    const spawned = combat.updateSpawns(1, findPosition);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.kind).toBe('hug');
    expect(combat.enemies.filter((enemy) => enemy.kind === 'hug')).toHaveLength(1);
    expect(combat.updateSpawns(0, findPosition)).toHaveLength(0);
  });

  it('blocks both monster types at the shared cap and refills slots freed by defeated enemies', () => {
    const combat = new NightCombat(() => 0);
    const rules = COMBAT_RULES.spawning;
    const template = combat.enemies[0]!;
    combat.enemies = Array.from({ length: rules.maxAlive }, (_, index) => ({
      ...template,
      id: `cap-${index}`,
    }));
    let positionCalls = 0;
    const findPosition = () => {
      positionCalls++;
      return { x: 100, y: 150 };
    };
    expect(combat.updateSpawns(rules.hugSpawnIntervalMs, findPosition)).toHaveLength(0);
    expect(positionCalls).toBe(0);
    const defeated = combat.enemies[0]!;
    defeated.health = 0;
    defeated.state = 'dead';
    const spawned = combat.updateSpawns(rules.intervalMaxMs, findPosition);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.kind).toBe('patrol');
    expect(positionCalls).toBe(1);
    expect(combat.enemies.filter((enemy) => enemy.state !== 'dead')).toHaveLength(rules.maxAlive);
    expect(combat.enemies).toContain(defeated);
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
    const combat = isolatedCombat();
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
    const combat = isolatedCombat();
    const enemy = combat.enemies[0]!;
    const player = { x: enemy.position.x + 40, y: enemy.position.y };
    advance(combat, player, 100);
    expect(enemy.state).toBe('windup');
    expect(advance(combat, { x: player.x + 100, y: player.y }, 500)).toBe(0);
  });
  it('blocks melee through walls, honors cooldown and returns a defeat only once', () => {
    const combat = isolatedCombat();
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
    const combat = isolatedCombat();
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

    const narrow = isolatedCombat();
    const target = narrow.enemies[0]!;
    const narrowPlayer = { x: target.position.x - 70, y: target.position.y };
    narrow.attack(narrowPlayer, Math.PI / 2, [], 15, 'stun-baton');
    expect(narrow.attackHit).toBe(false);
    expect(target.health).toBe(70);
  });
  it('reduces enemy detection range while the silent cloak is active', () => {
    const combat = isolatedCombat();
    const enemy = combat.enemies[0]!;
    const player = { x: enemy.position.x - 150, y: enemy.position.y };
    combat.update(100, player, true, false, true, [], bounds, 0.5);
    expect(enemy.state).toBe('patrol');
    combat.update(100, player, true, false, true, [], bounds);
    expect(enemy.state).toBe('chase');
  });
  it.each([
    ['folding-ruler', 20, 55],
    ['long-broom', 22, 100],
    ['window-breaker', 55, 65],
    ['night-watch-spear', 70, 145],
  ] as const)('uses the configured %s weapon profile', (weaponId, damage, distance) => {
    const combat = isolatedCombat();
    const enemy = combat.enemies[0]!;
    const player = { x: enemy.position.x - distance, y: enemy.position.y };
    combat.attack(player, 0, [], damage, weaponId);
    expect(enemy.health).toBe(70 - damage);
    expect(combat.currentWeaponId).toBe(weaponId);
  });
  it('preserves baton durability across weapon switches and restores it for a new raid', () => {
    const combat = isolatedCombat();
    combat.enemies = [];
    const player = { x: 1000, y: 1000 };
    expect(combat.getWeaponUsesRemaining('stun-baton')).toBe(15);
    for (let i = 0; i < 15; i++) {
      combat.tick(1200);
      combat.attack(player, 0, [], 15, 'stun-baton');
      expect(combat.getWeaponUsesRemaining('stun-baton')).toBe(14 - i);
      combat.tick(1200);
      combat.attack(player, 0, [], 35, 'training-bat');
      expect(combat.getWeaponUsesRemaining('training-bat')).toBeNull();
      expect(combat.getWeaponUsesRemaining('stun-baton')).toBe(14 - i);
    }
    combat.tick(1200);
    combat.attack(player, 0, [], 15, 'stun-baton');
    expect(combat.weaponUsesRemaining).toBe(0);
    expect(combat.swingMs).toBe(0);
    expect(combat.attackCooldown).toBe(0);
    combat.reset();
    expect(combat.getWeaponUsesRemaining('stun-baton')).toBe(15);
  });
  it('stuns mutated enemies for 600ms and respects the 75-unit attack range', () => {
    const combat = isolatedCombat('hug');
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
    const combat = isolatedCombat('hug');
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
  it('warns for the complete configured interval after a request expires before chasing or damaging', () => {
    const combat = isolatedCombat('hug');
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    const player = { x: hug.position.x + 30, y: hug.position.y };
    expect(advance(combat, player, COMBAT_RULES.hug.requestDurationMs)).toBe(0);
    expect(hug.state).toBe('mutation-warning');
    expect(hug.mutated).toBe(false);
    const position = { ...hug.position };
    expect(advance(combat, player, COMBAT_RULES.hug.mutationWarningMs - 100)).toBe(0);
    expect(hug.state).toBe('mutation-warning');
    expect(hug.position).toEqual(position);
    expect(advance(combat, player, 100)).toBe(0);
    expect(hug.state).toBe('chase');
    expect(hug.mutated).toBe(true);
    expect(advance(combat, player, 600)).toBe(COMBAT_RULES.enemy.mutated.damage);
  });

  it('warns on the first effective hit and cannot have its warning extended by repeated attacks', () => {
    const combat = isolatedCombat('hug');
    const hug = combat.enemies.find((enemy) => enemy.kind === 'hug')!;
    const player = { x: hug.position.x + 30, y: hug.position.y };

    combat.attack(player, Math.PI, [], 35);
    expect(hug.mutated).toBe(false);
    expect(hug.state).toBe('mutation-warning');
    expect(hug.health).toBe(COMBAT_RULES.hug.health - 35);

    advance(combat, player, 500);
    combat.attack(player, Math.PI, [], 35);
    expect(hug.timer).toBe(COMBAT_RULES.hug.mutationWarningMs - 500);
    advance(combat, player, 500);
    expect(hug.mutated).toBe(true);
    expect(hug.state).toBe('chase');
    expect(hug.health).toBe(COMBAT_RULES.hug.health);
  });

  it('warns on the first electric shock against a calmed hug monster', () => {
    const combat = isolatedCombat('hug');
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    const player = { x: hug.position.x + 30, y: hug.position.y };
    advance(combat, player, 1_500, true);
    expect(hug.state).toBe('calmed');
    combat.attack(player, Math.PI, [], 15, 'stun-baton');
    expect(hug.state).toBe('mutation-warning');
    expect(hug.mutated).toBe(false);
    advance(combat, player, COMBAT_RULES.hug.mutationWarningMs);
    expect(hug.mutated).toBe(true);
    expect(hug.state).toBe('chase');
    expect(hug.calmHitCount).toBe(0);
  });

  it('keeps a lethally hit hug monster dead throughout the warning interval', () => {
    const combat = isolatedCombat('hug');
    const hug = combat.enemies[0]!;
    const player = { x: hug.position.x - 30, y: hug.position.y };
    expect(combat.attack(player, 0, [], 100)).toEqual([hug]);
    advance(combat, player, COMBAT_RULES.hug.mutationWarningMs + 100);
    expect(hug.state).toBe('dead');
    expect(hug.health).toBe(0);
    expect(hug.mutated).toBe(false);
  });

  it('warns when player damage interrupts an active hug, including its completion frame', () => {
    for (const progress of [500, COMBAT_RULES.hug.calmHoldDurationMs - 100]) {
      const combat = isolatedCombat('hug');
      const hug = combat.enemies[0]!;
      const player = { x: hug.position.x - 30, y: hug.position.y };
      advance(combat, player, progress, true);
      const attacker = isolatedCombat().enemies[0]!;
      attacker.position = { ...player };
      attacker.state = 'windup';
      attacker.timer = 100;
      combat.enemies.push(attacker);
      const result = combat.update(100, player, true, true, true, [], bounds);
      expect(result.damage).toBe(COMBAT_RULES.enemy.patrol.damage);
      expect(result.calmed).toEqual([]);
      expect(hug.state).toBe('mutation-warning');
      expect(hug.hugProgress).toBe(0);
      expect(hug.mutated).toBe(false);
    }
  });

  it('allows retry after releasing a hug and ignores player damage when not calming', () => {
    const combat = isolatedCombat('hug');
    const hug = combat.enemies[0]!;
    const player = { x: hug.position.x - 30, y: hug.position.y };
    advance(combat, player, 500, true);
    advance(combat, player, 100, false);
    combat.onPlayerDamaged();
    expect(hug.state).toBe('request');
    expect(hug.mutated).toBe(false);
    expect(hug.hugProgress).toBe(0);
    advance(combat, player, COMBAT_RULES.hug.calmHoldDurationMs, true);
    expect(hug.state).toBe('calmed');
  });

  it('loses a hug target when the player escapes instead of mutating', () => {
    const combat = isolatedCombat('hug');
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    const near = { x: hug.position.x + 30, y: hug.position.y };
    advance(combat, near, 100);
    expect(hug.state).toBe('request');
    advance(combat, { x: hug.position.x + 450, y: hug.position.y }, 100);
    expect(hug.state).toBe('patrol');
    expect(hug.mutated).toBe(false);
  });

  it('detects a mutated hug monster from an expanded chase range', () => {
    const combat = isolatedCombat('hug');
    const hug = combat.enemies.find((e) => e.kind === 'hug')!;
    hug.mutated = true;
    const player = { x: hug.position.x + 280, y: hug.position.y };
    combat.update(100, player, true, false, true, [], bounds);
    expect(hug.state).toBe('chase');
  });

  it('lets a calm hug monster request attention beyond the mutated patrol detection range', () => {
    const combat = isolatedCombat('hug');
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

describe('amplifier monster', () => {
  const ampRules = COMBAT_RULES.enemy.amplifier;
  const stepUpdate = (
    combat: NightCombat,
    player: { x: number; y: number },
    totalMs: number,
    options: {
      lightOn?: boolean;
      walls?: readonly { x: number; y: number; width: number; height: number }[];
      invulnerable?: boolean;
    } = {},
  ) => {
    let damage = 0;
    let soundWaveHit = false;
    const amplifierWindups: string[] = [];
    for (let remaining = totalMs; remaining > 0;) {
      const step = Math.min(50, remaining);
      const res = combat.update(
        step,
        player,
        options.lightOn ?? true,
        false,
        true,
        options.walls ?? [],
        bounds,
        options.invulnerable ?? false,
      );
      damage += res.damage;
      soundWaveHit = soundWaveHit || res.soundWaveHit;
      for (const enemy of res.amplifierWindups) amplifierWindups.push(enemy.id);
      remaining -= step;
    }
    return { damage, soundWaveHit, amplifierWindups };
  };

  it('has 85 health and dies in exactly 3 training-bat hits', () => {
    const combat = isolatedCombat('amplifier');
    const amp = combat.enemies[0]!;
    expect(amp.health).toBe(85);
    const inFront = () => ({ x: amp.position.x - 50, y: amp.position.y });

    expect(combat.attack(inFront(), 0, [], 35, 'training-bat')).toHaveLength(0);
    expect(amp.health).toBe(50);
    combat.tick(COMBAT_RULES.player.attack.cooldownMs);
    expect(combat.attack(inFront(), 0, [], 35, 'training-bat')).toHaveLength(0);
    expect(amp.health).toBe(15);
    combat.tick(COMBAT_RULES.player.attack.cooldownMs);
    const third = combat.attack(inFront(), 0, [], 35, 'training-bat');
    expect(third).toHaveLength(1);
    expect(amp.state).toBe('dead');
  });

  it('detects at 380 lit / 160 dark and remembers the player for 5 seconds after losing sight', () => {
    const combat = isolatedCombat('amplifier');
    const amp = combat.enemies[0]!;
    // 暗处 170 单位不会发现，150 单位会发现
    stepUpdate(combat, { x: amp.position.x + 170, y: amp.position.y }, 100, { lightOn: false });
    expect(amp.state).toBe('patrol');
    // 明处 390 单位不会发现，370 单位会发现
    stepUpdate(combat, { x: amp.position.x + 390, y: amp.position.y }, 100, { lightOn: true });
    expect(amp.state).toBe('patrol');
    stepUpdate(combat, { x: amp.position.x + 370, y: amp.position.y }, 100, { lightOn: true });
    expect(amp.state).toBe('chase');

    // 墙体遮挡视线后，记忆维持 5 秒，超过 5 秒返回巡逻
    const wall = { x: amp.position.x + 120, y: amp.position.y - 80, width: 30, height: 160 };
    stepUpdate(combat, { x: amp.position.x + 260, y: amp.position.y }, 4_800, {
      lightOn: true,
      walls: [wall],
    });
    expect(amp.state).toBe('chase');
    stepUpdate(combat, { x: amp.position.x + 260, y: amp.position.y }, 400, {
      lightOn: true,
      walls: [wall],
    });
    expect(amp.state).toBe('patrol');
  });

  it('retreats at 70 units/s when player is within 100 units, or attacks in place when cornered', () => {
    const combat = isolatedCombat('amplifier');
    const amp = combat.enemies[0]!;
    const player = { x: amp.position.x + 70, y: amp.position.y };
    const startX = amp.position.x;
    stepUpdate(combat, player, 200);
    expect(amp.state).toBe('chase');
    // 200ms * 70 = 14 单位向左后退
    expect(startX - amp.position.x).toBeCloseTo(14, 1);

    // 背后放一堵紧贴的墙挡住退路，怪应原地进入蓄力作战
    const combatCornered = isolatedCombat('amplifier');
    const cornered = combatCornered.enemies[0]!;
    const backWall = {
      x: cornered.position.x - 45,
      y: cornered.position.y - 100,
      width: 30,
      height: 200,
    };
    const res = stepUpdate(
      combatCornered,
      { x: cornered.position.x + 70, y: cornered.position.y },
      100,
      { walls: [backWall] },
    );
    expect(cornered.state).toBe('windup');
    expect(res.amplifierWindups).toContain(cornered.id);
  });

  it('tracks during first 0.6s windup, locks aim in final 0.3s, fires wave, recovers 1s, and enforces 4.5s interval', () => {
    const combat = isolatedCombat('amplifier');
    const amp = combat.enemies[0]!;
    const player = { x: amp.position.x + 220, y: amp.position.y };

    // 进入 0.9s 蓄力，触发电流预警并记录 4.5s 冷却
    const start = combat.update(100, player, true, false, true, [], bounds);
    expect(amp.state).toBe('windup');
    expect(amp.windupLocked).toBe(false);
    expect(start.amplifierWindups.map((enemy) => enemy.id)).toEqual([amp.id]);

    // 前 0.6s 内玩家横向移动，方向仍会跟随更新
    const shifted = { x: amp.position.x + 220, y: amp.position.y + 80 };
    stepUpdate(combat, shifted, 400);
    expect(amp.windupLocked).toBe(false);
    expect(amp.attackAngle).toBeCloseTo(Math.atan2(80, 220), 2);

    // 进入最后 0.3s 锁定方向，之后玩家大角度跑开不再转头
    stepUpdate(combat, shifted, 200);
    expect(amp.windupLocked).toBe(true);
    const lockedAngle = amp.attackAngle!;
    stepUpdate(combat, { x: amp.position.x, y: amp.position.y - 220 }, 150);
    expect(amp.attackAngle).toBe(lockedAngle);

    // 蓄力结束发射 1 道声波，同时怪物进入 1s recovery 原地停顿
    stepUpdate(combat, { x: amp.position.x, y: amp.position.y - 220 }, 150);
    expect(combat.soundWaves).toHaveLength(1);
    expect(combat.soundWaves[0]!.angle).toBe(lockedAngle);
    expect(amp.state).toBe('recovery');
    const recoveryPos = { ...amp.position };
    stepUpdate(combat, player, 500);
    expect(amp.state).toBe('recovery');
    expect(amp.position).toEqual(recoveryPos);

    // 1s 后摇结束恢复追击，但距离上次蓄力开始不足 4.5s 时不能再次蓄力
    stepUpdate(combat, player, 500);
    expect(amp.state).toBe('chase');
    stepUpdate(combat, player, 2_400);
    expect(amp.state).not.toBe('windup');

    // 满足 4.5s 后才能再次蓄力
    stepUpdate(combat, player, 400);
    expect(amp.state).toBe('windup');
  });

  it('flies at 300 u/s up to 320 units, hits once within 96 width for 10 dmg, and is blocked by walls', () => {
    const combat = isolatedCombat('amplifier');
    const amp = combat.enemies[0]!;
    // 1) 命中测试：发射后声波沿 +X 飞行，玩家在 y+40（半宽 48 以内）应恰好命中 1 次
    combat.soundWaves.push({
      id: 'w-hit',
      position: { x: 1000, y: 1000 },
      angle: 0,
      travelled: 0,
      hitPlayer: false,
    });
    // 让怪远离避免干扰
    amp.position = { x: 100, y: 100 };
    const hit1 = stepUpdate(combat, { x: 1150, y: 1040 }, 500, { lightOn: false });
    expect(hit1.damage).toBe(10);
    expect(hit1.soundWaveHit).toBe(true);
    // 同波继续飞过同一玩家不二次结算（且先清掉无敌帧以单独验证单波去重）
    combat.invulnerability = 0;
    const hit2 = stepUpdate(combat, { x: 1165, y: 1040 }, 50, { lightOn: false });
    expect(hit2.damage).toBe(0);
    expect(hit2.soundWaveHit).toBe(false);

    // 飞满 320 单位后自动消失
    stepUpdate(combat, { x: 2500, y: 2500 }, 700, { lightOn: false });
    expect(combat.soundWaves).toHaveLength(0);

    // 2) 横向超出 48 半径（y+60）不命中
    combat.invulnerability = 0;
    combat.soundWaves.push({
      id: 'w-miss',
      position: { x: 1000, y: 1000 },
      angle: 0,
      travelled: 0,
      hitPlayer: false,
    });
    const miss = stepUpdate(combat, { x: 1150, y: 1060 }, 500, { lightOn: false });
    expect(miss.damage).toBe(0);
    expect(miss.soundWaveHit).toBe(false);

    // 3) 遇实体障碍立即消失，不穿墙伤人
    combat.soundWaves.length = 0;
    combat.soundWaves.push({
      id: 'w-wall',
      position: { x: 1000, y: 1000 },
      angle: 0,
      travelled: 0,
      hitPlayer: false,
    });
    const wall = { x: 1080, y: 940, width: 30, height: 120 };
    const blocked = stepUpdate(combat, { x: 1150, y: 1000 }, 500, {
      lightOn: false,
      walls: [wall],
    });
    expect(blocked.damage).toBe(0);
    expect(blocked.soundWaveHit).toBe(false);
    expect(combat.soundWaves).toHaveLength(0);
  });

  it('does not apply damage or debuff when blocked by hurt or item invulnerability', () => {
    const combat = isolatedCombat('amplifier');
    const amp = combat.enemies[0]!;
    amp.position = { x: 100, y: 100 };

    // 0.8s 受伤无敌期
    combat.invulnerability = COMBAT_RULES.player.invulnerabilityMs;
    combat.soundWaves.push({
      id: 'w-invuln-1',
      position: { x: 1000, y: 1000 },
      angle: 0,
      travelled: 0,
      hitPlayer: false,
    });
    const r1 = stepUpdate(combat, { x: 1030, y: 1000 }, 100, {
      lightOn: false,
      invulnerable: false,
    });
    expect(r1.damage).toBe(0);
    expect(r1.soundWaveHit).toBe(false);

    // 道具无敌期（playerInvulnerable = true）
    combat.invulnerability = 0;
    combat.soundWaves.length = 0;
    combat.soundWaves.push({
      id: 'w-invuln-2',
      position: { x: 1000, y: 1000 },
      angle: 0,
      travelled: 0,
      hitPlayer: false,
    });
    const r2 = stepUpdate(combat, { x: 1030, y: 1000 }, 100, {
      lightOn: false,
      invulnerable: true,
    });
    expect(r2.damage).toBe(0);
    expect(r2.soundWaveHit).toBe(false);
  });

  it('interrupts windup on stun-baton shock with 1.5s lockout, while training-bat does not interrupt', () => {
    const combat = isolatedCombat('amplifier');
    const amp = combat.enemies[0]!;
    // 进入蓄力
    combat.update(
      100,
      { x: amp.position.x + 200, y: amp.position.y },
      true,
      false,
      true,
      [],
      bounds,
    );
    expect(amp.state).toBe('windup');

    // 训练棍打中蓄力中的扩音器怪：仅扣血，不打断蓄力
    combat.attack({ x: amp.position.x - 50, y: amp.position.y }, 0, [], 35, 'training-bat');
    expect(amp.health).toBe(50);
    expect(amp.state).toBe('windup');

    // 冷却后再用电击器眩晕：立刻打断蓄力进入 stunned，且至少等待 1.5s 才允许重新蓄力
    combat.attackCooldown = 0;
    combat.attack({ x: amp.position.x - 40, y: amp.position.y }, 0, [], 15, 'stun-baton');
    expect(amp.state).toBe('stunned');
    expect(amp.cooldown).toBeGreaterThanOrEqual(ampRules.interruptCooldownMs);
    expect(combat.soundWaves).toHaveLength(0);

    // 经过 1.2s 眩晕恢复，但距打断不足 1.5s，仍不能重新蓄力
    const midRange = { x: amp.position.x + 210, y: amp.position.y };
    stepUpdate(combat, midRange, 1_200);
    expect(amp.state).toBe('chase');
    stepUpdate(combat, midRange, 200);
    expect(amp.state).not.toBe('windup');

    // 满 1.5s 后恢复蓄力能力
    stepUpdate(combat, midRange, 200);
    expect(amp.state).toBe('windup');
  });

  it('enforces max 1 amplifier per encounter region and max 2 amplifiers on the map', () => {
    const combat = new NightCombat(() => 0);
    combat.enemies = [];
    // 第一次刷新到 (200, 200) -> 成功
    const wave1 = combat.updateSpawns(ampRules.spawnIntervalMs, () => ({
      x: 200,
      y: 200,
    }));
    expect(wave1.filter((e) => e.kind === 'amplifier')).toHaveLength(1);

    // 同一遭遇区域 (250, 250) 尝试再刷第 2 只 -> 被同区域上限拦截
    expect(encounterRegionKey({ x: 200, y: 200 })).toBe(encounterRegionKey({ x: 250, y: 250 }));
    const wave2 = combat.updateSpawns(ampRules.spawnIntervalMs, () => ({
      x: 250,
      y: 250,
    }));
    expect(wave2.filter((e) => e.kind === 'amplifier')).toHaveLength(0);

    // 不同遭遇区域 (1600, 1600) -> 成功刷出第 2 只
    const wave3 = combat.updateSpawns(ampRules.spawnIntervalMs, () => ({
      x: 1600,
      y: 1600,
    }));
    expect(wave3.filter((e) => e.kind === 'amplifier')).toHaveLength(1);
    expect(combat.enemies.filter((e) => e.kind === 'amplifier' && e.state !== 'dead')).toHaveLength(
      2,
    );

    // 第 3 个不同区域 (2600, 2600) -> 被全图上限 2 拦截
    const wave4 = combat.updateSpawns(ampRules.spawnIntervalMs, () => ({
      x: 2600,
      y: 2600,
    }));
    expect(wave4.filter((e) => e.kind === 'amplifier')).toHaveLength(0);
  });
});
