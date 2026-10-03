import { createHmac, randomUUID } from 'node:crypto';
const [url, days = '7'] = process.argv.slice(2);
const secret = process.env.INVITE_SECRET;
if (!url || !secret || secret.length < 32 || !Number.isFinite(Number(days)) || Number(days) < 1 || Number(days) > 30) {
  console.error('Set INVITE_SECRET, then run: node scripts/review-link.mjs https://YOUR-WORKER.workers.dev 7');
  process.exit(1);
}
const target = new URL('/library.html', url);
if (target.protocol !== 'https:' && target.hostname !== 'localhost') throw Error('Use an HTTPS website URL.');
const payload = Buffer.from(JSON.stringify({ id: randomUUID(), scope: 'review', exp: Math.floor(Date.now() / 1000) + Number(days) * 86400 })).toString('base64url');
target.hash = new URLSearchParams({ review: `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}` }).toString();
console.log(`Private team review link (can access all submitted voices; share only with reviewers):\n${target.href}`);
