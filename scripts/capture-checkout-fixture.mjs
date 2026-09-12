// Captures a real screenshot of demo/checkout.html plus the precise on-screen
// coordinates of the total and the Complete Purchase button, so the hover
// latency benchmark (tests/perf/hover-latency.test.ts) exercises the actual
// OCR/extraction pipeline against real pixels instead of a synthetic word
// list. Run manually with `node scripts/capture-checkout-fixture.mjs`; the
// output fixture is checked in, so this does not run as part of `npm test`.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const root = path.dirname(fileURLToPath(import.meta.url));
const demoPath = path.join(root, '..', 'demo', 'checkout.html');
const fixtureDir = path.join(root, '..', 'tests', 'fixtures');
const pngPath = path.join(fixtureDir, 'checkout.png');
const metaPath = path.join(fixtureDir, 'checkout.json');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 738, height: 1000 } });
await page.goto('file://' + demoPath);
await page.waitForSelector('#buy');

const totalBox = await page.locator('#total').boundingBox();
const buttonBox = await page.locator('#buy').boundingBox();
await page.screenshot({ path: pngPath });
const viewport = page.viewportSize();
await browser.close();

writeFileSync(metaPath, JSON.stringify({
  imageWidth: viewport.width,
  imageHeight: viewport.height,
  totalBox,
  buttonBox,
  capturedAt: new Date().toISOString(),
}, null, 2));

console.log('Wrote', pngPath, 'and', metaPath);
console.log('total box:', totalBox);
console.log('button box:', buttonBox);
