import { chromium } from 'playwright';

const shot = process.argv[2] || 'C:/Users/Admin/AppData/Local/Temp/opencode/game-shot.png';
const shot2 = process.argv[3] || 'C:/Users/Admin/AppData/Local/Temp/opencode/game-battle.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200));
});
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: shot });
// мета -> в бой
const mPlay = await page.$('#mPlay');
if (mPlay) {
  await mPlay.click();
  await page.waitForTimeout(800);
}
// лобби -> в бой
const start = await page.$('#startBtn');
if (start) {
  await start.click();
  await page.waitForTimeout(6000);
}
await page.screenshot({ path: shot2 });
console.log(JSON.stringify({ errors: errors.slice(0, 10) }));
await browser.close();
