import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker, { verifyInvite, detectAudio, storeSubmission, CONSENT_VERSION } from '../src/worker.js';

const secret = 'test-secret-that-is-at-least-thirty-two-characters';
const inviteId = '11111111-1111-4111-8111-111111111111';
const receipt = '22222222-2222-4222-8222-222222222222';
function token(exp = Math.floor(Date.now() / 1000) + 3600, scope) {
  const payload = Buffer.from(JSON.stringify({ id: inviteId, exp, name: 'Test Actor', scope })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
const env = { INVITE_SECRET: secret, GITHUB_TOKEN: 'test-only', SAMPLES_REPO: 'test/private', SAMPLES_BRANCH: 'main' };
function audio() { const b = Buffer.alloc(256); b.write('RIFF'); b.write('WAVE', 8); return b; }
function request(overrides = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ voice_name: 'Alex', transcript: 'Every voice has a story to tell.', submission_id: receipt, consent: CONSENT_VERSION, ...overrides })) form.set(key, value);
  form.set('audio', new Blob([audio()]), 'sample.wav');
  return new Request('https://voice.test/api/submit', { method: 'POST', headers: { Origin: 'https://voice.test', Authorization: `Bearer ${token()}` }, body: form });
}
test('signed invitation verifies; tampered and expired invitations fail', async () => {
  assert.equal((await verifyInvite(token(), secret)).name, 'Test Actor');
  await assert.rejects(verifyInvite(token() + 'x', secret), { status: 401 });
  await assert.rejects(verifyInvite(token(1), secret), { status: 401 });
});
test('recognizes phone containers and rejects executable content', () => {
  assert.equal(detectAudio(audio()), 'wav');
  assert.equal(detectAudio(Buffer.from('0000ftypisom')), 'm4a');
  assert.equal(detectAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), 'webm');
  assert.throws(() => detectAudio(Buffer.from('<html>not audio</html>')), { status: 400 });
});
test('upload rejects absent consent, unsafe receipt, wrong origin and exhausted rate limit', async () => {
  assert.equal((await worker.fetch(request({ consent: '' }), env)).status, 400);
  assert.equal((await worker.fetch(request({ submission_id: '../outside' }), env)).status, 400);
  const wrongOrigin = request(); wrongOrigin.headers.set('Origin', 'https://other.test');
  assert.equal((await worker.fetch(wrongOrigin, env)).status, 403);
  assert.equal((await worker.fetch(request(), { ...env, UPLOAD_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
});
test('chunked oversized requests are rejected without GitHub calls', async () => {
  const req = new Request('https://voice.test/api/submit', { method: 'POST', headers: { Origin: 'https://voice.test', Authorization: `Bearer ${token()}`, 'Content-Type': 'multipart/form-data; boundary=x' }, body: new Uint8Array(10 * 1024 * 1024 + 65537) });
  assert.equal((await worker.fetch(req, env)).status, 413);
});
test('storage refuses a public repository', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ private: false }));
  await assert.rejects(storeSubmission(env, {}, audio()), { status: 503 });
});
test('atomic submission retries a concurrent branch update; receipt retries do not duplicate', async t => {
  let updates = 0, commits = 0, stored = null, metadata = null;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname.replace('/repos/test/private', '');
    const body = options.body ? JSON.parse(options.body) : null;
    if (path === '') return Response.json({ private: true });
    if (path.startsWith('/contents/')) return stored ? Response.json({ content: Buffer.from(JSON.stringify(stored)).toString('base64') }) : Response.json({}, { status: 404 });
    if (path === '/git/blobs') { if (body.encoding === 'utf-8') metadata = JSON.parse(body.content); return Response.json({ sha: 'blob' }); }
    if (path.startsWith('/git/ref/')) return Response.json({ object: { sha: `parent-${updates}` } });
    if (path.startsWith('/git/commits/')) return Response.json({ tree: { sha: 'tree' } });
    if (path === '/git/trees') { assert.equal(body.tree.length, 2); return Response.json({ sha: 'new-tree' }); }
    if (path === '/git/commits') { commits++; return Response.json({ sha: 'commit' }); }
    if (path.startsWith('/git/refs/')) {
      assert.equal(body.force, false); updates++;
      if (updates === 1) return Response.json({}, { status: 422 });
      stored = metadata; return Response.json({});
    }
    throw Error(`Unexpected path ${path}`);
  });
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 201); assert.equal((await response.json()).receipt, receipt);
  assert.equal(commits, 2); assert.equal(stored.consent.accepted, true); assert.equal(stored.sha256.length, 64);
  assert.match(stored.speaker_id, /^[a-f0-9-]{36}$/);
  assert.equal((await worker.fetch(request(), env)).status, 201); assert.equal(commits, 2);
  assert.equal((await worker.fetch(request({ transcript: 'Different words should not overwrite a saved take.' }), env)).status, 409);
});
test('private library rejects missing credentials and ordinary actor links', async () => {
  for (const path of ['/api/library', '/api/library/audio']) {
    assert.equal((await worker.fetch(new Request(`https://voice.test${path}`), env)).status, 401);
    assert.equal((await worker.fetch(new Request(`https://voice.test${path}`, { headers: { Authorization: `Bearer ${token()}` } }), env)).status, 403);
  }
});
test('shared link creates isolated upload-only sessions without an invitation', async () => {
  const sessionEnv = { ...env, PUBLIC_INTAKE: 'true' };
  const open = () => worker.fetch(new Request('https://voice.test/api/session', { method: 'POST', headers: { Origin: 'https://voice.test' } }), sessionEnv);
  const one = await (await open()).json(), two = await (await open()).json();
  const actorOne = await verifyInvite(one.token, secret), actorTwo = await verifyInvite(two.token, secret);
  assert.equal(actorOne.scope, 'upload'); assert.notEqual(actorOne.id, actorTwo.id);
  assert.equal(one.consent_version, CONSENT_VERSION); assert.ok(one.consent);
  assert.equal((await worker.fetch(new Request('https://voice.test/api/library', { headers: { Authorization: `Bearer ${one.token}` } }), sessionEnv)).status, 403);
  assert.equal((await worker.fetch(new Request('https://voice.test/api/session', { method: 'POST', headers: { Origin: 'https://evil.test' } }), sessionEnv)).status, 403);
  assert.equal((await worker.fetch(new Request('https://voice.test/api/session', { method: 'POST' }), env)).status, 503);
  assert.equal((await worker.fetch(new Request('https://voice.test/api/session', { method: 'POST', headers: { Origin: 'https://voice.test' } }), { ...sessionEnv, UPLOAD_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
});
test('reviewer library paginates metadata and proxies private audio without exposing credentials', async t => {
  const review = token(undefined, 'review');
  const get = path => worker.fetch(new Request(`https://voice.test${path}`, { headers: { Authorization: `Bearer ${review}` } }), env);
  const meta = { invite_id: inviteId, submission_id: receipt, voice_name: '<script>Alex</script>', transcript: 'These are the exact spoken words.', language: 'English', audio_file: 'original.wav', received_at: '2026-10-03T00:00:00Z' };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname.replace('/repos/test/private', '');
    if (path === '') return Response.json({ private: true });
    if (path === '/git/trees/main') return Response.json({ truncated: false, tree: Array.from({ length: 21 }, () => ({ type: 'blob', path: `submissions/${inviteId}/${receipt}/metadata.json`, sha: 'metadata' })) });
    if (path === '/git/blobs/metadata') return Response.json({ content: Buffer.from(JSON.stringify(meta)).toString('base64') });
    if (path.startsWith('/contents/')) { assert.equal(options.headers.Accept, 'application/vnd.github.raw+json'); return new Response(audio()); }
    throw Error(path);
  });
  const first = await (await get('/api/library')).json();
  assert.equal(first.takes.length, 20); assert.equal(first.next, 20); assert.equal(first.takes[0].voice_name, meta.voice_name);
  const last = await (await get('/api/library?offset=20')).json(); assert.equal(last.takes.length, 1); assert.equal(last.next, null);
  const preview = await get(`/api/library/audio?invite=${inviteId}&id=${receipt}&file=original.wav`);
  assert.equal(preview.status, 200); assert.equal(preview.headers.get('Content-Type'), 'audio/wav'); assert.equal(preview.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), audio());
  assert.equal((await get(`/api/library/audio?invite=${inviteId}&id=${receipt}&file=../../secret`)).status, 400);
});
