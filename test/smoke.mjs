import puppeteer from 'puppeteer-core';
// Smoke test for spike A. Needs: npm i --no-save puppeteer-core, a Chrome binary (CHROME=...), and the
// page served (npm run serve). Usage: node test/smoke.mjs [gl|gpu]. Screenshots go to OUT (default ./shots).
import { mkdirSync } from 'node:fs';
const OUT = process.env.OUT || 'shots'; mkdirSync(OUT, { recursive: true });
const extra = process.argv[2] === 'gpu' ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', ...extra] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 800 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()}`));
await page.goto(process.env.URL || 'http://127.0.0.1:5310/', { waitUntil: 'load' });
await page.waitForFunction('window.underspace', { timeout: 20000 }).catch(() => logs.push('underspace never appeared'));
const tag = process.argv[2] || 'gl';
const drag = async (pts) => { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 6 }); await page.mouse.up(); };
// draw three lines in the canvas view (left half)
await drag([[120, 500], [300, 300], [520, 220]]);
await drag([[150, 250], [330, 420], [560, 520]]);
await drag([[200, 600], [400, 590], [600, 380]]);
await page.mouse.click(350, 150); // a dot
// draw one in the scene view on the top plane
await page.select('#plane', 'top');
await drag([[900, 450], [1000, 520], [1150, 480]]);
await page.select('#plane', 'front');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${OUT}/${tag}-1-drawn.png` });
// select with a box, then play
await page.keyboard.press('v');
await drag([[100, 200], [620, 620]]);
const sel = await page.evaluate(() => underspace.state.selection.size);
await page.select('#rQuant', 'starts'); await page.select('#rScale', 'pentatonic');
await page.keyboard.press(' ');
await new Promise((r) => setTimeout(r, 1500));
const playing = await page.evaluate(() => ({ btn: document.getElementById('play').textContent, status: document.getElementById('brushStatus').textContent }));
await page.screenshot({ path: `${OUT}/${tag}-2-playing.png` });
await page.select('#proj', 'making');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/${tag}-3-making.png` });
await page.keyboard.press(' ');
// brush error handling
await page.evaluate(() => { const c = document.getElementById('code'); c.value = 'this is not code('; c.dispatchEvent(new Event('input')); });
await new Promise((r) => setTimeout(r, 700));
const errStatus = await page.evaluate(() => document.getElementById('brushStatus').textContent);
await page.select('#preset', 'pizzicato');
// replay
const before = await page.evaluate(() => ({ marks: underspace.state.marks.size, clips: underspace.take.clips.length, names: underspace.take.clips.map((c) => c.name) }));
await page.click('#replay');
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${OUT}/${tag}-4-replaying.png` });
await page.waitForFunction(() => document.getElementById('replay').textContent === 'replay take', { timeout: 60000 }).catch(() => logs.push('replay did not finish'));
const after = await page.evaluate(() => ({ marks: underspace.state.marks.size, clips: underspace.take.clips.length, sel: underspace.state.selection.size, preset: underspace.state.brush.preset, quant: underspace.state.reading.quant, backend: underspace.views.backend, cmds: underspace.commands().length }));
await page.evaluate(() => underspace.call('transport.stop'));
await page.select('#proj', 'space');
await page.screenshot({ path: `${OUT}/${tag}-5-after.png` });
console.log(JSON.stringify({ sel, playing, errStatus, before, after }, null, 1));
console.log(logs.join('\n') || 'no console output');
await browser.close();
