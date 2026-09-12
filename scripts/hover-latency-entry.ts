// Thin re-export barrel so scripts/measure-hover-latency.mjs can bundle the
// exact production modules with esbuild and run them under plain Node —
// matching how the packaged app's dist/main.cjs actually executes, rather
// than Vitest's worker-thread sandbox (which breaks tesseract.js's own
// Node worker spawning). No logic is reimplemented here.
export { recognize, disposeRecognizer } from '../src/desktop/recognize';
export { extractPurchase } from '../src/desktop/extract';
export { forecast } from '../src/domain/forecast';
export { demoSnapshot } from '../src/fixtures/demo';
export { createConversationManager } from '../src/service/conversation/controller';
export type { Frame } from '../src/desktop/types';
