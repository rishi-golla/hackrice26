import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const token = randomBytes(32).toString('hex');
const child = spawn(process.execPath, ['dist/service.cjs'], { env: { ...process.env, FLICKY_SESSION_TOKEN: token, FLICKY_DATA_MODE: 'synthetic' }, stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
try {
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('service startup timeout')), 10_000);
    child.stdout.on('data', chunk => { buffer += chunk; const line = buffer.split('\n')[0]; if (!line) return; clearTimeout(timer); resolve(JSON.parse(line)); });
    child.on('exit', code => reject(new Error(`service exited during startup (${code})`)));
  });
  const bootstrapHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const health = await fetch(`http://127.0.0.1:${info.port}/health`);
  if (!(await health.json()).ok) throw new Error('health failed');
  const loginResponse = await fetch(`http://127.0.0.1:${info.port}/auth/login`, { method: 'POST', headers: bootstrapHeaders, body: JSON.stringify({ email: 'demo@example.com', password: 'demo-password' }) });
  if (!loginResponse.ok) throw new Error('demo login failed');
  const login = await loginResponse.json();
  const headers = { authorization: `Bearer ${login.id}`, 'content-type': 'application/json' };
  const session = await (await fetch(`http://127.0.0.1:${info.port}/session`, { method: 'POST', headers, body: JSON.stringify({ accountId: info.accountId }) })).json();
  const answer = await (await fetch(`http://127.0.0.1:${info.port}/turn`, { method: 'POST', headers, body: JSON.stringify({ sessionId: session.sessionId, turnId: 'e2e-1', text: 'Can I afford $200 today?' }) })).json();
  if (!answer.forecast || answer.forecast.minimumCents !== -8_000) throw new Error('forecast grounding failed');
  console.log('service e2e passed');
} finally {
  child.stdin.end(); child.kill('SIGTERM');
}
