// Real, measured latency evidence for Part 4 / Task 4 ("measure five hover
// runs... separating OCR, router, forecast and speech latency. Report target
// <=3 seconds as a measured result, not a promise").
//
// Bundles the exact production modules (real tesseract.js recognition, real
// desktop-coordinate extraction, real deterministic forecast, real
// conversation controller) with esbuild and runs them under plain Node —
// the same runtime shape as the packaged app's dist/main.cjs — because
// Vitest's own worker-thread sandbox breaks tesseract.js's Node worker
// spawning.
//
// This run also reproduces and documents a confirmed bug in the real
// production adapter src/desktop/recognize.ts (see docs/verification.md):
// it explicitly forwards `workerPath`/`corePath` to tesseract.js's
// createWorker() even when they are undefined, which overwrites
// tesseract.js's own working default via object-spread and crashes
// `new Worker(undefined)`. Every real call in the app (main.ts calls
// recognize(frame) with no options) hits this. To still obtain real
// measured OCR latency, this script also drives the lower-level
// PersistentOcrRecognizer primitive directly with a corrected worker
// factory (omitting the two poisoned keys) — that primitive itself has no
// bug; only the adapter around it does.
//
// Fixture: tests/fixtures/checkout.png + checkout.json, a real headless-
// Chromium screenshot of demo/checkout.html (scripts/capture-checkout-fixture.mjs).
//
// Run: node scripts/measure-hover-latency.mjs
import { build } from 'esbuild';
import { createWorker } from 'tesseract.js';
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

const mod = await import(pathToFileURL(outfile).href);
const { recognizeViaAdapter, disposeRecognizer, extractPurchase, forecast, demoSnapshot, createConversationManager } = mod;

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

console.log('=== Step 1: reproduce the real app\'s exact call shape ===');
console.log('main.ts calls recognize(frame) with no options, exactly like this:');
try {
  await recognizeViaAdapter(frame());
  console.log('UNEXPECTED: succeeded. Bug may already be fixed.');
} catch (error) {
  console.log('CONFIRMED BUG:', error instanceof Error ? error.message : error);
  console.log('Root cause: src/desktop/recognize.ts\'s createRuntimeWorker() passes');
  console.log('  { workerPath: config.workerPath, corePath: config.corePath }');
  console.log('to tesseract.js createWorker() — both undefined on every real call.');
  console.log('tesseract.js merges options as {...defaultOptions, ..._options}, so an');
  console.log('explicit `workerPath: undefined` key OVERWRITES tesseract.js\'s own');
  console.log('working default, and `new Worker(undefined)` throws immediately.');
  console.log('Every real screen-capture OCR call in the shipped app hits this.\n');
}
await disposeRecognizer().catch(() => {});

console.log('=== Step 2: a second, independent confirmed bug ===');
console.log('PersistentOcrRecognizer.recognize() calls worker.recognize(frame.png) with');
console.log('no output-format argument, then reads result.data.words. This installed');
console.log('tesseract.js version (^6.0.0) returns data.words === undefined by default —');
console.log('word-level boxes only exist under data.blocks[].paragraphs[].lines[].words[]');
console.log('when you explicitly call worker.recognize(image, {}, { blocks: true }).');
console.log('mapWords() throws OcrRecognitionError(\'invalid-result\') on every real image,');
console.log('independent of the workerPath bug above. Confirmed by direct inspection:\n');
try {
  const probe = await createWorker('eng', 1, { langPath: path.join(root, 'dist/ocr'), logger: () => {} });
  const bad = await probe.recognize(frame().png);
  console.log('  worker.recognize(image) data.words =', bad.data.words);
  await probe.terminate();
} catch (error) { console.log('  probe failed:', error instanceof Error ? error.message : error); }

console.log('\n=== Step 3: measure real end-to-end latency via a corrected call shape ===');
console.log('(Local to this benchmark only — does not modify src/desktop/ocr/recognize.ts.');
console.log('Demonstrates the fix: request { blocks: true } and walk blocks/paragraphs/lines.)\n');

function wordsFromBlocks(data) {
  const words = [];
  (data.blocks ?? []).forEach((block, blockIndex) => {
    (block.paragraphs ?? []).forEach((paragraph, paragraphIndex) => {
      (paragraph.lines ?? []).forEach((line, lineIndex) => {
        for (const word of line.words ?? []) {
          words.push({
            text: word.text, confidence: word.confidence, lineId: `${blockIndex}-${paragraphIndex}-${lineIndex}`,
            box: { x: word.bbox.x0, y: word.bbox.y0, width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0 },
          });
        }
      });
    });
  });
  return words;
}
// One persistent worker across all 5 runs, same shape PersistentOcrRecognizer
// intends (first run pays cold-start; later runs are warm) — just with the
// output-format argument that primitive's own recognize() is missing.
const worker = await createWorker('eng', 1, { langPath: path.join(root, 'dist/ocr'), logger: () => {} });

const ocrSamples = []; const extractSamples = []; const forecastSamples = []; const routerSamples = [];
const snapshot = demoSnapshot();
const manager = createConversationManager();
let lastAmount = null;

for (let run = 0; run < 5; run += 1) {
  const f = frame();

  const ocrStart = performance.now();
  const raw = await worker.recognize(f.png, {}, { blocks: true });
  const words = wordsFromBlocks(raw.data);
  ocrSamples.push(performance.now() - ocrStart);

  const extractStart = performance.now();
  const candidate = extractPurchase(words, f, cursor);
  extractSamples.push(performance.now() - extractStart);
  lastAmount = candidate.amountCents;

  const forecastStart = performance.now();
  if (run === 0) console.log('  run 0 candidate:', JSON.stringify(candidate));
  if (!candidate.amountCents || candidate.amountCents <= 0) {
    console.log(`  run ${run}: no valid amount extracted (state=${candidate.state} reason=${candidate.reason}) — skipping forecast/router for this run`);
    forecastSamples.push(NaN); routerSamples.push(NaN);
    continue;
  }

  const forecastResult = forecast(snapshot, candidate.amountCents ?? 0, 10_000);
  forecastSamples.push(performance.now() - forecastStart);

  const session = manager.createSession(snapshot.accountId, snapshot.mode);
  manager.registerCandidate(session.id, { id: `bench-${run}`, label: 'Screen purchase', cents: candidate.amountCents ?? 0, date: snapshot.today, origin: 'screen', confirmed: false });
  const routerStart = performance.now();
  await manager.turn({ sessionId: session.id, turnId: `t-${run}`, text: 'Can I afford this?', candidateId: `bench-${run}` }, snapshot);
  routerSamples.push(performance.now() - routerStart);
}
await worker.terminate();

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
