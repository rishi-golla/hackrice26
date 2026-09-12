import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// The isolated test entry imports no dotenv and uses no real provider credentials.
const directory = await mkdtemp(path.join(tmpdir(), 'cappy-verification-e2e-'));
try {
  const outfile = path.join(directory, 'verification.cjs');
  await build({ entryPoints: ['tests/e2e/verification.ts'], outfile, bundle: true, platform: 'node', format: 'cjs', external: ['fastify'] });
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [outfile], { stdio: 'inherit', env: { ...process.env, NODE_PATH: path.resolve('node_modules') } });
    child.on('error', reject); child.on('exit', resolve);
  });
  if (code !== 0) process.exitCode = 1;
} finally { await rm(directory, { recursive: true, force: true }); }
