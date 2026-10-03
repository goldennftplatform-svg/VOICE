import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const secret = randomBytes(32).toString('hex');
const payload = Buffer.from(JSON.stringify({ id: randomUUID(), name: 'Your voice', exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url');
const token = `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
const port = process.env.PORT || '8787';
console.log(`\nLOCAL PREVIEW — uploads disabled\nOpen this link once the server is ready:\nhttp://localhost:${port}/#invite=${token}\n`);
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), 'dev', '--port', port, '--var', `INVITE_SECRET:${secret}`, '--var', 'PREVIEW_ONLY:true'], { stdio: 'inherit' });
child.on('exit', code => process.exit(code || 0));
process.on('SIGINT', () => child.kill('SIGINT'));
