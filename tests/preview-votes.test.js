import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handlePreviewVotes } from '../src/preview-votes.js';

const origin = 'https://goldennftplatform-svg.github.io';
const visitorA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const visitorB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function environment() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_preview_votes.sql', import.meta.url), 'utf8'));
  function statement(sql, parameters = []) {
    return { sql, parameters, bind: (...args) => statement(sql, args), all: async () => ({ results: db.prepare(sql).all(...parameters) }) };
  }
  return { PREVIEW_DB: {
    prepare: statement,
    batch: async statements => {
      db.exec('BEGIN');
      try {
        const result = statements.map(item => item.sql.startsWith('SELECT') ? { results: db.prepare(item.sql).all(...item.parameters) } : { results: [], ...db.prepare(item.sql).run(...item.parameters) });
        db.exec('COMMIT'); return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  }, ASSETS: { fetch: async () => Response.json({ clips: [{ id: 'scene-one-v1' }, { id: 'scene-two-v1' }] }) }, close: () => db.close() };
}
const vote = (visitor, value, clip = 'scene-one-v1', site = origin) => new Request('https://voice.test/api/preview/votes', { method: 'POST', headers: { Origin: site, 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor, value, clip_id: clip }) });
test('votes persist, are shared, cannot duplicate, and can be changed or removed', async t => {
  const env = environment(); t.after(env.close);
  let response = await handlePreviewVotes(vote(visitorA, 1), env);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.deepEqual(await response.json(), { clip_id: 'scene-one-v1', up: 1, down: 0, mine: 1 });
  assert.equal((await (await handlePreviewVotes(vote(visitorA, 1), env)).json()).up, 1);
  assert.deepEqual(await (await handlePreviewVotes(vote(visitorB, -1), env)).json(), { clip_id: 'scene-one-v1', up: 1, down: 1, mine: -1 });
  let result = await (await handlePreviewVotes(new Request(`https://voice.test/api/preview/votes?visitor=${visitorA}`, { headers: { Origin: origin } }), env)).json();
  assert.deepEqual(result.votes['scene-one-v1'], { up: 1, down: 1, mine: 1 });
  assert.deepEqual(result.votes['scene-two-v1'], { up: 0, down: 0, mine: 0 });
  result = await (await handlePreviewVotes(vote(visitorA, -1), env)).json();
  assert.deepEqual(result, { clip_id: 'scene-one-v1', up: 0, down: 2, mine: -1 });
  result = await (await handlePreviewVotes(vote(visitorA, 0), env)).json();
  assert.deepEqual(result, { clip_id: 'scene-one-v1', up: 0, down: 1, mine: 0 });
});
test('rejects unrelated origins, invalid visitors/values, unknown clips, oversized bodies and rate excess', async t => {
  const env = environment(); t.after(env.close);
  const rejected = await handlePreviewVotes(vote(visitorA, 1, 'scene-one-v1', 'https://other.test'), env);
  assert.equal(rejected.status, 403); assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await handlePreviewVotes(vote('bad-id', 1), env)).status, 400);
  assert.equal((await handlePreviewVotes(vote(visitorA, 999), env)).status, 400);
  assert.equal((await handlePreviewVotes(vote(visitorA, 1, 'private-reference'), env)).status, 400);
  assert.equal((await handlePreviewVotes(new Request('https://voice.test/api/preview/votes', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: ' '.repeat(3000) }), env)).status, 413);
  assert.equal((await handlePreviewVotes(vote(visitorA, 1), { ...env, VOTE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
});
test('preflight supports GitHub Pages; unavailable storage reports failure instead of pretending to save', async () => {
  const response = await handlePreviewVotes(new Request('https://voice.test/api/preview/votes', { method: 'OPTIONS', headers: { Origin: origin } }), {});
  assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal((await handlePreviewVotes(vote(visitorA, 1), {})).status, 503);
});
