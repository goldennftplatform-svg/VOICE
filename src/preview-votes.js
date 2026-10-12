const PAGES_ORIGIN = 'https://goldennftplatform-svg.github.io';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const COUNT_SQL = 'SELECT COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS up, COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS down FROM preview_votes WHERE clip_id = ?';
class VoteError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function voterHash(id) {
  if (!UUID.test(id || '')) throw new VoteError(400, 'Refresh the page to start a voting session.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`voice-preview-v1:${id}`));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function readBody(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new VoteError(415, 'Send votes as JSON.');
  if (Number(request.headers.get('Content-Length')) > 2048) throw new VoteError(413, 'Vote request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new VoteError(400, 'Missing vote.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2048) { await reader.cancel(); throw new VoteError(413, 'Vote request is too large.'); }
    chunks.push(value);
  }
  try { return JSON.parse(await new Blob(chunks).text()); }
  catch { throw new VoteError(400, 'Invalid vote.'); }
}
async function catalog(request, env) {
  let response;
  // New previews become voteable after a normal GitHub push, without requiring
  // a Worker redeploy for every audio addition. No private-repository token is used.
  if (env.PREVIEW_CATALOG_URL) {
    try { response = await fetch(env.PREVIEW_CATALOG_URL, { cf: { cacheTtl: 60, cacheEverything: true } }); } catch { /* use deployed public catalog */ }
  }
  if (!response?.ok) response = await env.ASSETS.fetch(new Request(new URL('/preview/catalog.json', request.url)));
  if (!response.ok) throw new VoteError(503, 'The preview catalog is being updated. Try again shortly.');
  const data = await response.json();
  if (!Array.isArray(data.clips) || data.clips.length > 500) throw new VoteError(503, 'Preview catalog unavailable.');
  return new Set(data.clips.filter(clip => /^[a-z0-9][a-z0-9_-]{0,119}$/.test(clip.id)).map(clip => clip.id));
}
export async function handlePreviewVotes(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = origin === PAGES_ORIGIN || origin === new URL(request.url).origin;
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '600';
  }
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  try {
    if (origin && !allowed) throw new VoteError(403, 'Use the public preview page to vote.');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'POST'].includes(request.method)) throw new VoteError(405, 'Method not allowed.');
    if (!env.PREVIEW_DB) throw new VoteError(503, 'Voting is not connected yet. Audio previews are still available.');
    if (request.method === 'POST' && !allowed) throw new VoteError(403, 'Use the public preview page to vote.');
    if (request.method === 'POST' && env.VOTE_LIMITER && !(await env.VOTE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) throw new VoteError(429, 'Please wait a minute before voting again.');
    const ids = await catalog(request, env);
    if (request.method === 'GET') {
      const visitor = new URL(request.url).searchParams.get('visitor');
      const counts = await env.PREVIEW_DB.prepare('SELECT clip_id, SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) AS up, SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS down FROM preview_votes GROUP BY clip_id').all();
      const mine = visitor ? await env.PREVIEW_DB.prepare('SELECT clip_id, value FROM preview_votes WHERE voter_hash = ?').bind(await voterHash(visitor)).all() : { results: [] };
      const byId = Object.fromEntries([...ids].map(id => [id, { up: 0, down: 0, mine: 0 }]));
      for (const row of counts.results) if (ids.has(row.clip_id)) Object.assign(byId[row.clip_id], { up: row.up, down: row.down });
      for (const row of mine.results) if (ids.has(row.clip_id)) byId[row.clip_id].mine = row.value;
      return reply({ votes: byId });
    }
    const body = await readBody(request);
    if (!body || !ids.has(body.clip_id) || ![1, -1, 0].includes(body.value)) throw new VoteError(400, 'Choose an available clip and an up or down vote.');
    const hash = await voterHash(body.visitor);
    const change = body.value === 0
      ? env.PREVIEW_DB.prepare('DELETE FROM preview_votes WHERE clip_id = ? AND voter_hash = ?').bind(body.clip_id, hash)
      : env.PREVIEW_DB.prepare('INSERT INTO preview_votes (clip_id, voter_hash, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(clip_id, voter_hash) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(body.clip_id, hash, body.value, new Date().toISOString());
    // D1 batch is transactional: totals reflect the persisted change, not a
    // local optimistic counter. Repeating a request cannot add a second vote.
    const results = await env.PREVIEW_DB.batch([change,
      env.PREVIEW_DB.prepare(COUNT_SQL).bind(body.clip_id),
      env.PREVIEW_DB.prepare('SELECT value FROM preview_votes WHERE clip_id = ? AND voter_hash = ?').bind(body.clip_id, hash)]);
    return reply({ clip_id: body.clip_id, ...results[1].results[0], mine: results[2].results[0]?.value || 0 });
  } catch (error) {
    return reply({ error: error instanceof VoteError ? error.message : 'Voting is temporarily unavailable. Please try again.' }, error instanceof VoteError ? error.status : 503);
  }
}
