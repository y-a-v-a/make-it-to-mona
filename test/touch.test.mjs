import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openGame, emptyRoom, placePlayer, simulate, playerState, geometry } from './helpers.mjs';

const PHONE = { hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } };
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

// Presses the joystick and drags it by (dx, dy) in units of its radius
async function holdStick(page, dx, dy) {
  const box = await page.locator('#stick').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = box.width / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx * r, cy + dy * r, { steps: 4 });
}

async function speedWithStick(page, dx, dy) {
  await emptyRoom(page);
  await placePlayer(page, 0, 3);
  await holdStick(page, dx, dy);
  await simulate(page, 1);
  const a = await playerState(page);
  await simulate(page, 1);
  const b = await playerState(page);
  await page.mouse.up();
  return Math.hypot(b.x - a.x, b.z - a.z);
}

test('touch controls show on a phone and stay hidden on a desktop', async () => {
  const phone = await openGame(browser, PHONE);
  assert.equal(await phone.page.isVisible('#stick'), true);
  assert.equal(await phone.page.isVisible('#restartBtn'), true);
  assert.equal(await phone.page.isVisible('#rotateHint'), false, 'landscape should not ask to rotate');
  await phone.page.close();

  const desktop = await openGame(browser);
  assert.equal(await desktop.page.isVisible('#stick'), false);
  assert.equal(await desktop.page.isVisible('#restartBtn'), false);
  await desktop.page.close();
});

test('a phone held upright is asked to turn sideways', async () => {
  const { page } = await openGame(browser, { ...PHONE, viewport: { width: 390, height: 844 } });
  assert.equal(await page.isVisible('#rotateHint'), true);
  await page.close();
});

test('the joystick walks the player in the pushed direction and starts the timer', async () => {
  const { page, errors } = await openGame(browser, PHONE);
  await emptyRoom(page);
  await placePlayer(page, 0, 3);
  await holdStick(page, 1, 0);           // push right: east
  await simulate(page, 1);
  let p = await playerState(page);
  assert.ok(p.x > 1, `pushing right moved the player to x=${p.x}`);
  assert.ok(Math.abs(p.z - 3) < 0.2, `pushing right also moved along z: ${p.z}`);
  await page.mouse.up();

  await holdStick(page, 0, -1);          // push up: north, towards the painting
  const before = await playerState(page);
  await simulate(page, 1);
  p = await playerState(page);
  assert.ok(p.z < before.z - 1, `pushing up moved the player from z=${before.z} to ${p.z}`);
  await page.mouse.up();
  await page.waitForFunction(() => document.getElementById('timer').textContent !== '0:00.0');
  assert.deepEqual(errors, []);
  await page.close();
});

test('releasing the joystick stops the player', async () => {
  const { page } = await openGame(browser, PHONE);
  await emptyRoom(page);
  await placePlayer(page, 0, 3);
  await holdStick(page, 1, 0);
  await simulate(page, 1);
  await page.mouse.up();
  await simulate(page, 1);
  const a = await playerState(page);
  await simulate(page, 1);
  const b = await playerState(page);
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) < 0.01, 'the player kept walking after letting go');
  await page.close();
});

test('the joystick is analog: a small push walks slower than a full push', async () => {
  const { page } = await openGame(browser, PHONE);
  const { C } = await geometry(page);
  const full = await speedWithStick(page, 1, 0);
  const half = await speedWithStick(page, 0.5, 0);
  const rest = await speedWithStick(page, 0.1, 0);   // inside the dead zone
  assert.ok(Math.abs(full - C.PLAYER_SPEED) < 0.1, `full push walks ${full} m/s`);
  assert.ok(half > 0.2 && half < full * 0.7, `half push walks ${half} m/s, full push ${full} m/s`);
  assert.ok(rest < 0.01, `a push inside the dead zone still walks ${rest} m/s`);
  await page.close();
});

test('the restart button starts a new visit', async () => {
  const { page } = await openGame(browser, PHONE);
  await placePlayer(page, 0, 3);
  await page.tap('#restartBtn');
  const p = await playerState(page);
  const { HW } = await geometry(page);
  assert.ok(Math.abs(p.x) > HW, `after restarting the player should be back in a corridor, x=${p.x}`);
  await page.close();
});

test('the win screen can be used by tapping', async () => {
  const { page } = await openGame(browser, PHONE);
  const { R, fence } = await geometry(page);
  await emptyRoom(page);
  await placePlayer(page, 0, fence.z + R + 1.5);
  await holdStick(page, 0, -1);
  await simulate(page, 2);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.__mona.won), true);

  await page.tap('#nameInput');
  await page.keyboard.type('tap1');
  await page.tap('#saveBtn');
  assert.equal((await page.evaluate(() => window.__mona.leaderboard()))[0].name, 'TAP1');
  assert.equal(await page.isVisible('#againBtn'), true);

  await page.tap('#againBtn');
  assert.equal(await page.evaluate(() => window.__mona.won), false);
  await page.close();
});

test('Skip closes the name form without saving', async () => {
  const { page } = await openGame(browser, PHONE);
  const { R, fence } = await geometry(page);
  await emptyRoom(page);
  await placePlayer(page, 0, fence.z + R + 1.5);
  await holdStick(page, 0, -1);
  await simulate(page, 2);
  await page.mouse.up();
  await page.tap('#skipBtn');
  assert.deepEqual(await page.evaluate(() => window.__mona.leaderboard()), []);
  assert.equal(await page.isVisible('#nameForm'), false);
  await page.close();
});

test('real touch events (not just mouse) drive the joystick', async () => {
  const { page } = await openGame(browser, PHONE);
  await emptyRoom(page);
  await placePlayer(page, 0, 3);
  const box = await page.locator('#stick').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', cx, cy);
  for (let i = 1; i <= 4; i++) await touch('touchMove', cx + (box.width / 2) * (i / 4), cy);
  await simulate(page, 1);
  const p = await playerState(page);
  await touch('touchEnd');
  assert.ok(p.x > 1, `a touch drag to the right moved the player to x=${p.x}`);
  await page.close();
});

test('the room and HUD stay clear of the notch / Dynamic Island', async () => {
  const { page } = await openGame(browser, PHONE);
  const insets = { left: 59, right: 59, bottom: 21 };   // an iPhone held sideways
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  const { HW, HD, C } = await geometry(page);
  const corners = [
    [-HW - C.CORRIDOR_LENGTH, C.ENTRANCE_Z], [HW + C.CORRIDOR_LENGTH, C.ENTRANCE_Z],   // corridor ends
    [-HW, -HD], [HW, -HD], [-HW, HD], [HW, HD],                                        // room corners
  ];
  const width = PHONE.viewport.width, height = PHONE.viewport.height;
  for (const [x, z] of corners) {
    const p = await page.evaluate(([px, pz]) => window.__mona.toScreen(px, pz), [x, z]);
    assert.ok(p.x >= insets.left - 1 && p.x <= width - insets.right + 1, `(${x}, ${z}) is drawn at x=${p.x}`);
    assert.ok(p.y >= 0 && p.y <= height - insets.bottom + 1, `(${x}, ${z}) is drawn at y=${p.y}`);
  }
  const hud = await page.locator('#hud').boundingBox();
  const restart = await page.locator('#restartBtn').boundingBox();
  assert.ok(hud.x >= insets.left, `the HUD starts at x=${hud.x}, under the notch`);
  assert.ok(restart.x + restart.width <= width - insets.right, 'the restart button is under the notch');
  await page.close();
});
