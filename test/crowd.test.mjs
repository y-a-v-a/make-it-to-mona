import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openGame, geometry } from './helpers.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

test('the room stays as full as the current crowd target', async () => {
  const { page } = await openGame(browser);
  const samples = await page.evaluate(() => {
    const out = [];
    for (let s = 0; s < 90; s++) {
      for (let i = 0; i < 60; i++) window.__mona.step(1 / 60);
      out.push({ count: window.__mona.npcs.length, target: window.__mona.crowdTarget() });
    }
    return out;
  });
  for (const { count, target } of samples) {
    assert.ok(count <= target, `${count} visitors while the target is ${target}`);
    assert.ok(count >= target * 0.85, `only ${count} visitors while the target is ${target}`);
  }
  await page.close();
});

test('the room gets busier over time', async () => {
  const { page } = await openGame(browser);
  const { C } = await geometry(page);
  const result = await page.evaluate(() => {
    const g = window.__mona;
    const start = g.npcs.length;
    for (let i = 0; i < 60 * 180; i++) g.step(1 / 60);
    return { start, later: g.npcs.length };
  });
  assert.ok(result.start <= C.CROWD_SIZE_START, `started with ${result.start} visitors`);
  const expected = Math.min(C.CROWD_SIZE_MAX, C.CROWD_SIZE_START + 3 * C.CROWD_GROWTH_PER_MINUTE);
  assert.ok(result.later >= expected * 0.85, `only ${result.later} visitors after 3 minutes, expected about ${expected}`);
  await page.close();
});

test('the crowd never grows past its maximum', async () => {
  const { page } = await openGame(browser);
  const { C } = await geometry(page);
  const result = await page.evaluate(() => {
    const g = window.__mona;
    g.CONFIG.CROWD_GROWTH_PER_MINUTE = 1000;
    let most = 0;
    for (let i = 0; i < 60 * 40; i++) { g.step(1 / 60); most = Math.max(most, g.npcs.length); }
    return { most, target: g.crowdTarget() };
  });
  assert.equal(result.target, C.CROWD_SIZE_MAX);
  assert.ok(result.most <= C.CROWD_SIZE_MAX, `${result.most} visitors, maximum is ${C.CROWD_SIZE_MAX}`);
  assert.ok(result.most >= C.CROWD_SIZE_MAX * 0.85, `the room only reached ${result.most} visitors`);
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
