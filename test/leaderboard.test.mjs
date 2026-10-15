import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openGame, emptyRoom, placePlayer, walk, geometry } from './helpers.mjs';

const KEY = 'mona-leaderboard';
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

// Walks straight up to the front of the fence in an empty room
async function winRound(page) {
  const { R, fence } = await geometry(page);
  await emptyRoom(page);
  await placePlayer(page, 0, fence.z + R + 1.5);
  await walk(page, 'ArrowUp', 2);
  assert.equal(await page.evaluate(() => window.__mona.won), true);
}

async function seed(page, entries) {
  await page.evaluate(([key, list]) => localStorage.setItem(key, JSON.stringify(list)), [KEY, entries]);
  await page.reload();
  await page.waitForFunction(() => window.__mona !== undefined);
}

const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), KEY);

test('after winning you can leave a name of up to 4 characters', async () => {
  const { page } = await openGame(browser);
  await winRound(page);
  assert.equal(await page.isVisible('#nameInput'), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'nameInput');

  // Lowercase is uppercased, symbols are dropped, and "r" does not restart the game
  await page.keyboard.type('r2-d2x');
  assert.equal(await page.inputValue('#nameInput'), 'R2D2');
  assert.equal(await page.evaluate(() => window.__mona.won), true, 'typing R restarted the game');

  await page.keyboard.press('Enter');
  const list = await stored(page);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'R2D2');
  assert.ok(list[0].time >= 0, `saved a negative time: ${list[0].time}`);
  assert.equal(await page.isVisible('#nameForm'), false);
  assert.equal(await page.textContent('#leaderboard li.you .name'), 'R2D2');
  assert.match(await page.textContent('#best'), /^Best: R2D2 /);
  assert.equal(await page.evaluate(() => window.__mona.won), true, 'saving the name also restarted the game');

  // The next Enter starts a new visit
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.__mona.won), false);
  await page.close();
});

test('the leaderboard survives a reload', async () => {
  const { page } = await openGame(browser);
  await winRound(page);
  await page.keyboard.type('MONA');
  await page.keyboard.press('Enter');
  await page.reload();
  await page.waitForFunction(() => window.__mona !== undefined);
  assert.equal((await page.evaluate(() => window.__mona.leaderboard()))[0].name, 'MONA');
  assert.match(await page.textContent('#best'), /^Best: MONA /);
  await page.close();
});

test('Escape skips saving a name', async () => {
  const { page } = await openGame(browser);
  await winRound(page);
  await page.keyboard.type('ABC');
  await page.keyboard.press('Escape');
  assert.deepEqual(await stored(page), []);
  assert.equal(await page.isVisible('#againHint'), true);
  await page.close();
});

test('only the fastest times are kept, fastest first', async () => {
  const { page } = await openGame(browser);
  const slow = Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, time: 100 + i * 10, date: `d${i}` }));
  await seed(page, slow.toReversed());
  await winRound(page);
  await page.keyboard.type('FAST');
  await page.keyboard.press('Enter');
  const list = await stored(page);
  assert.equal(list.length, 10);
  assert.equal(list[0].name, 'FAST');
  assert.deepEqual(list.map((e) => e.time), [...list.map((e) => e.time)].sort((a, b) => a - b));
  assert.ok(!list.some((e) => e.name === 'S9'), 'the slowest time should have dropped off');
  assert.equal(await page.locator('#leaderboard li').count(), 10);
  await page.close();
});

test('a time that is not in the top 10 does not ask for a name', async () => {
  const { page } = await openGame(browser);
  const fast = Array.from({ length: 10 }, (_, i) => ({ name: `F${i}`, time: 0, date: `d${i}` }));
  await seed(page, fast);
  await winRound(page);
  assert.equal(await page.isVisible('#nameForm'), false);
  assert.equal(await page.isVisible('#againHint'), true);
  assert.equal((await stored(page)).length, 10);
  await page.close();
});

test('names are shown as text, never as HTML', async () => {
  const { page } = await openGame(browser);
  await seed(page, [{ name: '<img src=x onerror=alert(1)>', time: 5, date: 'd' }]);
  assert.equal(await page.locator('#leaderboard img').count(), 0);
  assert.match(await page.textContent('#leaderboard'), /<img/);
  await page.close();
});

test('a corrupt leaderboard does not break the game', async () => {
  const { page, errors } = await openGame(browser);
  await page.evaluate((key) => localStorage.setItem(key, '{not json'), KEY);
  await page.reload();
  await page.waitForFunction(() => window.__mona !== undefined);
  assert.deepEqual(await page.evaluate(() => window.__mona.leaderboard()), []);
  await winRound(page);
  assert.equal(await page.isVisible('#nameInput'), true);
  assert.deepEqual(errors, []);
  await page.close();
});
