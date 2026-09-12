// Real, measured latency evidence for Part 4 / Task 4 ("measure five hover
// runs... separating OCR, router, forecast and speech latency. Report target
// <=3 seconds as a measured result, not a promise").
//
// Bundles the exact, unmodified production modules — src/desktop/recognize.ts
// (real tesseract.js recognition), src/desktop/extract.ts (real desktop-
// coordinate extraction), src/domain/forecast.ts (real deterministic
// forecast), src/service/conversation/controller.ts (real conversation
// controller) — with esbuild and runs them under plain Node, the same
// runtime shape as the packaged app's dist/main.cjs. This has to run outside
// Vitest because Vitest's own worker-thread sandbox breaks tesseract.js's
// Node worker spawning.
//
// Fixture: tests/fixtures/checkout.png + checkout.json, a real headless-
// Chromium screenshot of demo/checkout.html (npm run bench:fixture).
//
// Run: npm run bench:hover
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outfile = path.join(root, '.hover-latency-bench-entry.cjs');

await build({
  entryPoints: [path.join(root, 'scripts/hover-latency-entry.ts')],
  outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['tesseract.js'],
});

const { recognize, disposeRecognizer, extractPurchase, forecast, demoSnapshot, createConversationManager } = await import(pathToFileURL(outfile).href);

const fixtureDir = path.join(root, 'tests', 'fixtures');
const meta = JSON.parse(readFileSync(path.join(fixtureDir, 'checkout.json'), 'utf8'));
const png = readFileSync(path.join(fixtureDir, 'checkout.png'));

function frame() {
  return {
    id: 'bench', capturedAt: Date.now(), displayId: 'bench-display',
    bounds: { x: 0, y: 0, width: meta.imageWidth, height: meta.imageHeight },
    workArea: { x: 0, y: 0, width: meta.imageWidth, height: meta.imageHeight },
    imageWidth: meta.imageWidth, imageHeight: meta.imageHeight,
    png: new Uint8Array(png),
  };
}
const cursor = {
  x: meta.buttonBox.x + meta.buttonBox.width / 2,
  y: meta.buttonBox.y + meta.buttonBox.height / 2,
  displayId: 'bench-display', at: Date.now(),
};
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function report(label, samples) {
  console.log(`${label}: median=${median(samples).toFixed(1)}ms max=${Math.max(...samples).toFixed(1)}ms  [${samples.map(s => s.toFixed(1)).join(', ')}]ms`);
}

const ocrSamples = []; const extractSamples = []; const forecastSamples = []; const routerSamples = [];
const snapshot = demoSnapshot();
const manager = createConversationManager();
let lastAmount = null;

for (let run = 0; run < 5; run += 1) {
  const f = frame();

  const ocrStart = performance.now();
  const words = await recognize(f);
  ocrSamples.push(performance.now() - ocrStart);

  const extractStart = performance.now();
  const candidate = extractPurchase(words, f, cursor);
  extractSamples.push(performance.now() - extractStart);
  lastAmount = candidate.amountCents;

  const forecastStart = performance.now();
  const forecastResult = forecast(snapshot, candidate.amountCents ?? 0, 10_000);
  forecastSamples.push(performance.now() - forecastStart);

  const session = manager.createSession(snapshot.accountId, snapshot.mode);
  manager.registerCandidate(session.id, { id: `bench-${run}`, label: 'Screen purchase', cents: candidate.amountCents ?? 0, date: snapshot.today, origin: 'screen', confirmed: false });
  const routerStart = performance.now();
  await manager.turn({ sessionId: session.id, turnId: `t-${run}`, text: 'Can I afford this?', candidateId: `bench-${run}` }, snapshot);
  routerSamples.push(performance.now() - routerStart);
}
await disposeRecognizer();

console.log('=== Hover-to-forecast latency: real production pipeline, real screenshot ===');
console.log('Fixture: tests/fixtures/checkout.png (real screenshot of demo/checkout.html)');
console.log(`Recognized amount: ${lastAmount === 20000 ? '$200.00 (correct)' : `UNEXPECTED: ${lastAmount}`}\n`);
report('OCR (real tesseract.js recognize, incl. first-run worker cold start)', ocrSamples);
report('extract (image-to-desktop coordinate + candidate logic)', extractSamples);
report('forecast (deterministic domain engine)', forecastSamples);
report('router + grounded reply (deterministic, no hosted LLM)', routerSamples);
const total = ocrSamples.map((v, i) => v + extractSamples[i] + forecastSamples[i] + routerSamples[i]);
report('end-to-end (excludes real screen capture + speech, both untimed here)', total);
console.log('\nNote: the 700ms dwell timer and real desktopCapturer screen grab are not');
console.log('included above (need a live Electron window + granted Screen Recording');
console.log('permission, both blocked in this automation session). ElevenLabs speech');
console.log('transcribe/synthesize latency is not measured: no credentials in this checkout.');

rmSync(outfile, { force: true });
rmSync(outfile + '.map', { force: true });
