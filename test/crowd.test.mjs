import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openGame, geometry } from './helpers.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

test('the room stays full of visitors', async () => {
  const { page } = await openGame(browser);
  const { C } = await geometry(page);
  const counts = await page.evaluate(() => {
    const out = [];
    for (let s = 0; s < 90; s++) {
      for (let i = 0; i < 60; i++) window.__mona.step(1 / 60);
      out.push(window.__mona.npcs.length);
    }
    return out;
  });
  assert.ok(Math.max(...counts) <= C.CROWD_SIZE, `more visitors than CROWD_SIZE: ${Math.max(...counts)}`);
  assert.ok(Math.min(...counts) >= C.CROWD_SIZE * 0.85, `the room emptied out to ${Math.min(...counts)}`);
  await page.close();
});

test('visitors enter, watch, leave and are removed', async () => {
  const { page } = await openGame(browser);
  const result = await page.evaluate(() => {
    const { STATES, step } = window.__mona;
    const seen = new Map();          // visitor -> list of states, in order
    const removed = new Set();
    let previous = new Set(window.__mona.npcs);
    for (let i = 0; i < 60 * 120; i++) {
      step(1 / 60);
      const current = new Set(window.__mona.npcs);
      for (const n of current) {
        const states = seen.get(n) ?? [];
        if (states.at(-1) !== n.state) states.push(n.state);
        seen.set(n, states);
      }
      for (const n of previous) if (!current.has(n)) removed.add(n);
      previous = current;
    }
    const full = [STATES.ENTER, STATES.APPROACH, STATES.WATCH, STATES.LEAVE, STATES.EXIT].join();
    const completed = [...removed].filter((n) => seen.get(n)?.join() === full).length;
    const leftEarly = [...removed].filter((n) => n.state !== STATES.EXIT).length;
    return { removed: removed.size, completed, leftEarly };
  });
  assert.ok(result.completed > 20, `only ${result.completed} visitors made the full visit`);
  assert.equal(result.leftEarly, 0, 'visitors were removed without leaving the room');
  await page.close();
});

test('visitors stay inside the walls and outside the fence', async () => {
  const { page } = await openGame(browser);
  const violations = await page.evaluate(() => {
    const { CONFIG: C, step } = window.__mona;
    const HW = C.ROOM_WIDTH / 2, HD = C.ROOM_DEPTH / 2, eps = 0.02;
    const z0 = C.ENTRANCE_Z - C.ENTRANCE_WIDTH / 2, z1 = C.ENTRANCE_Z + C.ENTRANCE_WIDTH / 2;
    // Walkable floor: the room plus both corridors (which run on into the dark)
    const walkable = (x, z) =>
      (Math.abs(x) <= HW && Math.abs(z) <= HD) || (z >= z0 && z <= z1);
    const out = [];
    for (let i = 0; i < 60 * 45; i++) {
      step(1 / 60);
      for (const n of window.__mona.npcs) {
        if (Math.hypot(n.x, n.z + HD) < C.FENCE_RADIUS + n.r - eps) out.push({ x: n.x, z: n.z, why: 'fence' });
        // Every point on the edge of the body must be on walkable floor
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2, rr = n.r - eps;
          if (!walkable(n.x + Math.cos(a) * rr, n.z + Math.sin(a) * rr)) { out.push({ x: n.x, z: n.z, why: 'wall' }); break; }
        }
      }
    }
    return out;
  });
  assert.deepEqual(violations.slice(0, 5), [], `${violations.length} wall or fence violations`);
  await page.close();
});

test('watchers crowd in front of the painting', async () => {
  const { page } = await openGame(browser);
  const stats = await page.evaluate(() => {
    const { CONFIG: C, STATES, step } = window.__mona;
    const HD = C.ROOM_DEPTH / 2;
    let watchers = 0, inFront = 0, samples = 0;
    // The crowd comes in waves, so average over two minutes
    for (let s = 1; s <= 120; s++) {
      for (let i = 0; i < 60; i++) step(1 / 60);
      if (s < 30 || s % 5) continue;
      const w = window.__mona.npcs.filter((n) => n.state === STATES.WATCH);
      watchers += w.length;
      inFront += w.filter((n) => Math.abs(Math.atan2(n.x, n.z + HD)) < Math.PI / 4).length;
      samples++;
    }
    return { avgWatchers: watchers / samples, frontShare: inFront / watchers };
  });
  assert.ok(stats.avgWatchers >= 15, `on average only ${stats.avgWatchers.toFixed(1)} people are watching`);
  assert.ok(stats.frontShare > 0.6, `only ${(stats.frontShare * 100).toFixed(0)}% of watchers stand in front`);
  await page.close();
});
