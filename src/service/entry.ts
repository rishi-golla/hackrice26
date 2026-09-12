import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { buildServer } from './server';
import { createSpeechDependencies } from './speech-config';
import { demoSnapshot } from '../fixtures/demo';
import type { Snapshot } from '../domain/types';

async function main() {
  const mode = process.env.FLICKY_DATA_MODE ?? 'synthetic';
  if (mode !== 'synthetic' && mode !== 'recorded-sandbox') throw new Error('Live Nessie contract is not verified. Select synthetic or recorded-sandbox explicitly.');
  let recording: Snapshot | undefined;
  if (mode === 'recorded-sandbox') {
    if (!process.env.FLICKY_SNAPSHOT_PATH) throw new Error('Recorded mode requires FLICKY_SNAPSHOT_PATH.');
    recording = JSON.parse(await readFile(process.env.FLICKY_SNAPSHOT_PATH, 'utf8'));
    if (recording?.mode !== mode) throw new Error('Recorded snapshot must be labeled recorded-sandbox.');
  }
  const sample = recording ?? demoSnapshot();
  const speech = createSpeechDependencies();
  const server = buildServer({ sessionToken: process.env.FLICKY_SESSION_TOKEN ?? '', accountIds: [sample.accountId], mode }, {
    async read(accountId) {
      if (accountId !== sample.accountId) throw new Error('Unknown account');
      // Fixtures retain their stated date/asOf; never relabel recorded data as fresh live data.
      return structuredClone(recording ?? demoSnapshot());
    },
  }, {
    transcribe: speech.transcribe,
    synthesize: speech.synthesize,
  });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  process.stdout.write(JSON.stringify({ port: Number(new URL(address).port), accountId: sample.accountId, mode,
    capabilities: { router: true, ...speech.capabilities, financialActions: false } }) + '\n');
  const stop = async () => { await server.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.stdin.resume(); process.stdin.on('end', stop);
}
main().catch(error => { process.stderr.write(error instanceof Error ? error.message + '\n' : 'Service failed\n'); process.exit(1); });
