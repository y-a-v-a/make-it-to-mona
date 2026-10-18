import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GAME_URL = pathToFileURL(path.join(root, 'index.html')).href;
const THREE_PATH = path.join(root, 'node_modules/three/build/three.module.js');

// Software WebGL, so the tests also run on machines and CI runners without a GPU
export function launchBrowser() {
  return chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}

// Deterministic Math.random (mulberry32), so a failing run can be reproduced
function seedRandom(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pass { hasTouch: true, isMobile: true, viewport } to emulate a phone
export async function openGame(browser, { seed = 42, viewport = { width: 1280, height: 800 }, ...device } = {}) {
  const page = await browser.newPage({ viewport, ...device });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(seedRandom, seed);
  // Serve Three.js from node_modules instead of the CDN: offline and pinned
  await page.route('**/three.module.js', (route) =>
    route.fulfill({ path: THREE_PATH, contentType: 'text/javascript' }));
  await page.goto(GAME_URL);
  await page.waitForFunction(() => window.__mona !== undefined);
  return { page, errors };
}

// Removes every visitor and stops new ones from spawning
export function emptyRoom(page) {
  return page.evaluate(() => {
    Object.assign(window.__mona.CONFIG, { CROWD_SIZE_START: 0, CROWD_SIZE_MAX: 0, CROWD_GROWTH_PER_MINUTE: 0 });
    window.__mona.npcs.length = 0;
  });
}

// Runs the simulation for the given number of seconds, synchronously in the page
export function simulate(page, seconds) {
  return page.evaluate((s) => {
    for (let i = 0; i < Math.round(s * 60); i++) window.__mona.step(1 / 60);
  }, seconds);
}

export function placePlayer(page, x, z) {
  return page.evaluate(([px, pz]) => {
    const p = window.__mona.player;
    p.x = px; p.z = pz; p.vx = 0; p.vz = 0;
  }, [x, z]);
}

// Holds an arrow key while stepping the simulation
export async function walk(page, key, seconds) {
  await page.keyboard.down(key);
  await simulate(page, seconds);
  await page.keyboard.up(key);
}

export const playerState = (page) =>
  page.evaluate(() => {
    const { player, won } = window.__mona;
    return { x: player.x, z: player.z, r: player.r, won };
  });

export const geometry = (page) =>
  page.evaluate(() => {
    const C = window.__mona.CONFIG;
    return {
      C, HW: C.ROOM_WIDTH / 2, HD: C.ROOM_DEPTH / 2, R: C.FENCE_RADIUS,
      fence: { x: 0, z: -C.ROOM_DEPTH / 2 },
    };
  });
