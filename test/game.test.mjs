import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchBrowser, openGame, emptyRoom, placePlayer, walk, playerState, geometry } from './helpers.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

test('the game loads without errors and renders a canvas', async () => {
  const { page, errors } = await openGame(browser);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('canvas').count(), 1);
  assert.equal(await page.textContent('#timer'), '0:00.0');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the configuration constants are exposed', async () => {
  const { page } = await openGame(browser);
  const { C } = await geometry(page);
  for (const key of ['CROWD_SIZE_START', 'CROWD_SIZE_MAX', 'CROWD_GROWTH_PER_MINUTE', 'NPC_SPEED', 'PLAYER_SPEED']) {
    assert.equal(typeof C[key], 'number', key);
    assert.ok(C[key] > 0, key);
  }
  await page.close();
});

test('the CDN import map pins the same Three.js version as package.json', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const cdnVersion = html.match(/three@([\d.]+)\//)?.[1];
  assert.equal(cdnVersion, pkg.devDependencies.three);
});

test('arrow keys move the player and start the timer', async () => {
  const { page } = await openGame(browser);
  const start = await playerState(page);
  // The player starts in a corridor, so walking towards the room is always possible
  const key = start.x < 0 ? 'ArrowRight' : 'ArrowLeft';
  await page.keyboard.down(key);
  // Real-time frames: wait for movement instead of a fixed delay (software rendering can be slow)
  await page.waitForFunction((x0) => Math.abs(window.__mona.player.x) < Math.abs(x0) - 0.2, start.x, { timeout: 10000 });
  await page.keyboard.up(key);
  assert.notEqual(await page.textContent('#timer'), '0:00.0');
  await page.close();
});

test('touching the fence in front of the painting wins', async () => {
  const { page } = await openGame(browser);
  const { R, fence } = await geometry(page);
  await emptyRoom(page);
  await placePlayer(page, 0, fence.z + R + 1.5);
  await walk(page, 'ArrowUp', 2);
  assert.equal((await playerState(page)).won, true);
  assert.match(await page.getAttribute('#overlay', 'class'), /show/);
  assert.match(await page.textContent('#winTime'), /You reached the Mona Lisa/);
  await page.close();
});

test('the player cannot move after winning', async () => {
  const { page } = await openGame(browser);
  const { R, fence } = await geometry(page);
  await emptyRoom(page);
  await placePlayer(page, 0, fence.z + R + 1.5);
  await walk(page, 'ArrowUp', 2);
  const before = await playerState(page);
  await walk(page, 'ArrowDown', 1);
  const after = await playerState(page);
  assert.ok(Math.abs(after.z - before.z) < 0.05, 'player kept moving after the win');
  await page.close();
});

test('R restarts the game with a full room', async () => {
  const { page } = await openGame(browser);
  const { C, R, fence } = await geometry(page);
  const crowd = { CROWD_SIZE_START: C.CROWD_SIZE_START, CROWD_SIZE_MAX: C.CROWD_SIZE_MAX };
  await emptyRoom(page);
  await placePlayer(page, 0, fence.z + R + 1.5);
  await walk(page, 'ArrowUp', 2);
  await page.evaluate((c) => { Object.assign(window.__mona.CONFIG, c); }, crowd);
  await page.keyboard.press('r');
  const state = await page.evaluate(() => ({ won: window.__mona.won, npcs: window.__mona.npcs.length }));
  assert.equal(state.won, false);
  assert.ok(state.npcs >= crowd.CROWD_SIZE_START * 0.9, `only ${state.npcs} visitors after restart`);
  assert.doesNotMatch(await page.getAttribute('#overlay', 'class') ?? '', /show/);
  await page.close();
});
