import { createHmac, randomUUID } from 'node:crypto';

const [url, name = '', days = '30'] = process.argv.slice(2);
const secret = process.env.INVITE_SECRET;
if (!url || !secret || secret.length < 32 || !Number.isFinite(Number(days)) || Number(days) < 1 || Number(days) > 365) {
  console.error('Set INVITE_SECRET (same as the Worker, 32+ characters), then run:\nnpm run invite -- https://voice-actor-intake.YOUR-SUBDOMAIN.workers.dev "Actor name" 30');
  process.exit(1);
}
const target = new URL(url);
if (target.protocol !== 'https:' && target.hostname !== 'localhost') throw Error('Use an HTTPS website URL.');
const payload = Buffer.from(JSON.stringify({ id: randomUUID(), name: name.slice(0, 60), exp: Math.floor(Date.now() / 1000) + Number(days) * 86400 })).toString('base64url');
const signature = createHmac('sha256', secret).update(payload).digest('base64url');
target.hash = new URLSearchParams({ invite: `${payload}.${signature}` }).toString();
console.log(target.href);
