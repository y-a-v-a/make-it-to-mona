import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openGame, emptyRoom, placePlayer, walk, playerState, geometry, simulate } from './helpers.mjs';

const EPS = 0.02;
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

test('the player cannot walk through the north and west walls', async () => {
  const { page } = await openGame(browser);
  const { HW, HD } = await geometry(page);
  await emptyRoom(page);

  await placePlayer(page, -HW + 1.5, -HD + 1.5);
  await walk(page, 'ArrowUp', 3);
  let p = await playerState(page);
  assert.ok(p.z >= -HD + p.r - EPS, `walked into the north wall: z=${p.z}`);

  await walk(page, 'ArrowLeft', 3);
  p = await playerState(page);
  assert.ok(p.x >= -HW + p.r - EPS, `walked into the west wall: x=${p.x}`);
  await page.close();
});

test('the player cannot leave through the dark end of a corridor', async () => {
  const { page } = await openGame(browser);
  const { HW, C } = await geometry(page);
  await emptyRoom(page);
  const { x } = await playerState(page);
  const side = Math.sign(x);
  await walk(page, side < 0 ? 'ArrowLeft' : 'ArrowRight', 3);
  const p = await playerState(page);
  assert.ok(Math.abs(p.x) <= HW + C.CORRIDOR_LENGTH - p.r + EPS, `left the corridor: x=${p.x}`);
  await page.close();
});

test('the fence cannot be trespassed', async () => {
  const { page } = await openGame(browser);
  const { R, fence } = await geometry(page);
  await emptyRoom(page);
  // Approach from the east side, along the wall, where touching does not win
  await placePlayer(page, R + 1.5, fence.z + 0.5);
  await walk(page, 'ArrowLeft', 4);
  const p = await playerState(page);
  const d = Math.hypot(p.x - fence.x, p.z - fence.z);
  assert.ok(d >= R + p.r - EPS, `inside the fence: distance ${d}`);
  assert.equal(p.won, false, 'touching the side of the fence should not win');
  await page.close();
});

test('visitors are heavier than the player when they bump into each other', async () => {
  const { page } = await openGame(browser);
  const moved = await page.evaluate(() => {
    const { npcs, player, step, CONFIG } = window.__mona;
    Object.assign(CONFIG, { CROWD_SIZE_START: 0, CROWD_SIZE_MAX: 0, CROWD_GROWTH_PER_MINUTE: 0 });
    const n = npcs[0];
    npcs.length = 0;
    npcs.push(n);
    n.x = 0; n.z = 3; n.vx = n.vz = 0;
    player.x = 0.3; player.z = 3; player.vx = player.vz = 0;
    step(1 / 60);
    return { player: Math.hypot(player.x - 0.3, player.z - 3), npc: Math.hypot(n.x, n.z - 3) };
  });
  assert.ok(moved.player > moved.npc, `player moved ${moved.player}, visitor moved ${moved.npc}`);
  await page.close();
});

test('soft collisions keep people from overlapping much', async () => {
  const { page } = await openGame(browser);
  await simulate(page, 20);
  const worst = await page.evaluate(() => {
    const all = [...window.__mona.npcs, window.__mona.player];
    let maxRatio = 0;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const overlap = a.r + b.r - Math.hypot(a.x - b.x, a.z - b.z);
        maxRatio = Math.max(maxRatio, overlap / (a.r + b.r));
      }
    }
    return maxRatio;
  });
  // Soft means a little squeezing is allowed, but nobody walks through anybody
  assert.ok(worst < 0.35, `worst overlap is ${(worst * 100).toFixed(0)}% of the combined radius`);
  await page.close();
});
