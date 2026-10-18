import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { launchBrowser, openGame } from './helpers.mjs';

const PHONE = { hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } };
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

// Pretends to be iPhone Safari, which has no fullscreen API for pages
const noFullscreen = () => {
  Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
  Object.defineProperty(Document.prototype, 'webkitFullscreenEnabled', { get: () => false });
};

test('every local file the page links to exists and is deployed', async () => {
  const html = await read('index.html');
  const workflow = await read('.github/workflows/pages.yml');
  const deployed = workflow.match(/cp -r (.+) _site\//)[1].split(/\s+/);
  const links = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !/^https?:/.test(h));
  assert.ok(links.length >= 2, 'expected the manifest and the icon to be linked');
  for (const href of links) {
    await stat(new URL(`../${href}`, import.meta.url));
    assert.ok(deployed.includes(href.split('/')[0]), `${href} is not copied to GitHub Pages`);
  }
});

test('the web app manifest is valid and its icons exist at the stated sizes', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.display, 'fullscreen');
  assert.equal(manifest.orientation, 'landscape');
  for (const icon of manifest.icons) {
    const png = await readFile(new URL(`../${icon.src}`, import.meta.url));
    const size = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;   // from the PNG header
    assert.equal(size, icon.sizes, `${icon.src} is ${size}`);
  }
});

test('where the browser allows it, the full screen button goes full screen', async () => {
  const { page } = await openGame(browser, PHONE);
  assert.equal(await page.isVisible('#fullscreenBtn'), true);
  assert.equal(await page.isVisible('#homeTip'), false, 'no home screen tip needed when full screen works');
  await page.tap('#fullscreenBtn');
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await page.tap('#fullscreenBtn');
  await page.waitForFunction(() => document.fullscreenElement === null);
  await page.close();
});

test('on an iPhone the home screen tip is shown once instead', async () => {
  const context = await browser.newContext(PHONE);
  await context.addInitScript(noFullscreen);
  await context.route('**/three.module.js', (route) =>
    route.fulfill({ path: new URL('../node_modules/three/build/three.module.js', import.meta.url).pathname }));
  const page = await context.newPage();
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.waitForFunction(() => window.__mona !== undefined);
  assert.equal(await page.isVisible('#fullscreenBtn'), false);
  assert.equal(await page.isVisible('#homeTip'), true);
  await page.tap('#homeTip');
  assert.equal(await page.isVisible('#homeTip'), false, 'tapping should close the tip');

  await page.reload();
  await page.waitForFunction(() => window.__mona !== undefined);
  assert.equal(await page.isVisible('#homeTip'), false, 'the tip should only be shown once');
  await context.close();
});

test('opened from the home screen, neither the button nor the tip is shown', async () => {
  const context = await browser.newContext(PHONE);
  await context.addInitScript(noFullscreen);
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }));
  await context.route('**/three.module.js', (route) =>
    route.fulfill({ path: new URL('../node_modules/three/build/three.module.js', import.meta.url).pathname }));
  const page = await context.newPage();
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.waitForFunction(() => window.__mona !== undefined);
  assert.equal(await page.isVisible('#fullscreenBtn'), false);
  assert.equal(await page.isVisible('#homeTip'), false);
  await context.close();
});

test('desktop shows neither the full screen button nor the tip', async () => {
  const { page } = await openGame(browser);
  assert.equal(await page.isVisible('#fullscreenBtn'), false);
  assert.equal(await page.isVisible('#homeTip'), false);
  await page.close();
});

test('an iPhone never gets the full screen button, whatever its browser claims', async () => {
  const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const { page } = await openGame(browser, { ...PHONE, userAgent: iphoneUA });
  assert.equal(await page.isVisible('#fullscreenBtn'), false);
  assert.equal(await page.isVisible('#homeTip'), true);
  await page.close();
});
