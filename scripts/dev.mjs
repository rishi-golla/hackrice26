import { spawn } from 'node:child_process';
import electron from 'electron';
// A single production-shaped runtime makes packaged-only bugs easier to catch.
const build = spawn(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
build.on('exit', code => {
  if (code) process.exit(code);
  const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  child.on('exit', status => process.exit(status ?? 0));
});
