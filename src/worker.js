const MAX_BYTES = 10 * 1024 * 1024;
export const CONSENT_VERSION = '2026-10-02';
export const CONSENT_TEXT = 'This is my voice, and I authorize the project team to store this recording and transcript in its private GitHub repository, download them, and use them for local AI voice cloning, model training, and speech generation for this project. I understand generated speech can contain words I did not record.';
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
const fail = (status, message) => { throw new HttpError(status, message); };
const base64 = bytes => {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
const unbase64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export async function verifyInvite(token, secret) {
  try {
    if (!secret || secret.length < 32 || !token || token.length > 2000) throw Error();
    const parts = token.split('.');
    if (parts.length !== 2) throw Error();
    const [payload, signature] = parts;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, unbase64url(signature), new TextEncoder().encode(payload))) throw Error();
    const invite = JSON.parse(new TextDecoder().decode(unbase64url(payload)));
    if (!Number.isSafeInteger(invite.exp) || invite.exp <= Date.now() / 1000 || !/^[a-z0-9-]{8,64}$/.test(invite.id)) throw Error();
    return invite;
  } catch { fail(401, 'This invitation is invalid or has expired. Ask the project team for a fresh link.'); }
}
export function detectAudio(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (ascii(4, 8) === 'ftyp') return 'm4a';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2)) return 'mp3';
  fail(400, 'Choose a WAV, M4A, MP3, WebM, OGG, or FLAC audio recording.');
}
async function github(env, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${env.SAMPLES_REPO}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'voice-actor-intake', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) {
    const e = new HttpError(502, 'Storage is temporarily unavailable. Your recording is still here; please try again.');
    e.githubStatus = response.status;
    throw e;
  }
  return response.json();
}
const post = body => ({ method: 'POST', body: JSON.stringify(body) });
async function existing(env, path) {
  try { return await github(env, `/contents/${path}?ref=${encodeURIComponent(env.SAMPLES_BRANCH || 'main')}`); }
  catch (e) { if (e.githubStatus === 404) return null; throw e; }
}
export async function storeSubmission(env, metadata, audio) {
  // Refuse storage if repository visibility changes. Never silently publish actors' voices.
  const repo = await github(env, '');
  if (!repo.private) fail(503, 'Private recording storage is not configured. Please contact the project team.');
  const dir = `submissions/${metadata.invite_id}/${metadata.submission_id}`;
  const manifestPath = `${dir}/metadata.json`;
  const checkDuplicate = async () => {
    const found = await existing(env, manifestPath);
    if (!found) return false;
    const saved = JSON.parse(new TextDecoder().decode(unbase64url(found.content.replace(/\s/g, ''))));
    if (saved.sha256 !== metadata.sha256 || saved.voice_name !== metadata.voice_name || saved.transcript !== metadata.transcript) fail(409, 'This take was already saved with different details. Remove and reselect the recording to submit a new take.');
    return true;
  };
  if (await checkDuplicate()) return;
  const audioBlob = await github(env, '/git/blobs', post({ content: base64(audio), encoding: 'base64' }));
  const metaBlob = await github(env, '/git/blobs', post({ content: JSON.stringify(metadata, null, 2), encoding: 'utf-8' }));
  const branch = encodeURIComponent(env.SAMPLES_BRANCH || 'main');
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await github(env, `/git/ref/heads/${branch}`);
    // Check AFTER the ref read so a concurrent retry cannot overwrite a saved receipt.
    if (await checkDuplicate()) return;
    const parent = await github(env, `/git/commits/${ref.object.sha}`);
    const tree = await github(env, '/git/trees', post({ base_tree: parent.tree.sha, tree: [
      { path: `${dir}/${metadata.audio_file}`, mode: '100644', type: 'blob', sha: audioBlob.sha },
      { path: manifestPath, mode: '100644', type: 'blob', sha: metaBlob.sha },
    ] }));
    const commit = await github(env, '/git/commits', post({ message: `Add voice submission ${metadata.submission_id}`, tree: tree.sha, parents: [ref.object.sha] }));
    try {
      await github(env, `/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
      return;
    } catch (e) { if (![409, 422].includes(e.githubStatus) || attempt === 3) throw e; }
  }
}
async function upload(request, env) {
  if (env.PREVIEW_ONLY === 'true') fail(503, 'Local preview only: recording and playback work, but uploads are disabled until deployment.');
  if (!env.GITHUB_TOKEN || !env.INVITE_SECRET) fail(503, 'The upload service is not configured yet. Please contact the project team.');
  if (request.headers.get('Origin') !== new URL(request.url).origin) fail(403, 'Please submit from the voice recording website.');
  const invite = await verifyInvite(request.headers.get('Authorization')?.replace(/^Bearer /, ''), env.INVITE_SECRET);
  if (env.UPLOAD_LIMITER && !(await env.UPLOAD_LIMITER.limit({ key: invite.id })).success) fail(429, 'Please wait one minute before trying again.');
  if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data')) fail(415, 'Use the recording form to submit audio.');
  // Bound streamed bodies too; Content-Length alone is not trustworthy.
  const limit = MAX_BYTES + 64 * 1024;
  if (Number(request.headers.get('Content-Length')) > limit) fail(413, 'The recording must be smaller than 10 MB.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'No recording was received.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); fail(413, 'The recording must be smaller than 10 MB.'); }
    chunks.push(value);
  }
  let form;
  try { form = await new Response(new Blob(chunks), { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData(); }
  catch { fail(400, 'The upload could not be read. Please select the recording again.'); }
  const text = key => typeof form.get(key) === 'string' ? form.get(key).trim() : '';
  const name = text('voice_name'); const transcript = text('transcript'); const id = text('submission_id');
  if (name.length < 2 || name.length > 60 || /[\u0000-\u001f]/.test(name)) fail(400, 'Enter a voice name between 2 and 60 characters.');
  if (transcript.length < 10 || transcript.length > 12000) fail(400, 'Include the words spoken in your recording (10–12,000 characters).');
  if (text('consent') !== CONSENT_VERSION) fail(400, 'Please confirm permission to use your voice.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) fail(400, 'Invalid recording receipt. Reload the page and try again.');
  const file = form.get('audio');
  if (!file || typeof file.arrayBuffer !== 'function' || file.size < 128) fail(400, 'Add a recording before submitting.');
  if (file.size > MAX_BYTES) fail(413, 'The recording must be smaller than 10 MB.');
  const audio = new Uint8Array(await file.arrayBuffer()); const extension = detectAudio(audio);
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', audio))].map(b => b.toString(16).padStart(2, '0')).join('');
  const metadata = { schema_version: 1, submission_id: id, invite_id: invite.id, voice_name: name, transcript, language: text('language').slice(0, 60) || 'English', audio_file: `original.${extension}`, bytes: audio.length, sha256, received_at: new Date().toISOString(), consent: { version: CONSENT_VERSION, text: CONSENT_TEXT, accepted: true }, validation: 'container signature only; decode and duration validation required locally' };
  await storeSubmission(env, metadata, audio);
  return json({ ok: true, receipt: id }, 201);
}
const uuidPattern = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
async function authorizeReview(request, env) {
  const invite = await verifyInvite(request.headers.get('Authorization')?.replace(/^Bearer /, ''), env.INVITE_SECRET);
  if (invite.scope !== 'review') fail(403, 'A private team review link is required. Actor invitations cannot browse recordings.');
  if (!env.GITHUB_TOKEN || env.PREVIEW_ONLY === 'true') fail(503, 'Private team storage is not connected yet.');
  if (!(await github(env, '')).private) fail(503, 'Private recording storage is not configured.');
}
async function listVoices(request, env) {
  await authorizeReview(request, env);
  const offset = Number(new URL(request.url).searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) fail(400, 'Invalid library page.');
  const tree = await github(env, `/git/trees/${encodeURIComponent(env.SAMPLES_BRANCH || 'main')}?recursive=1`);
  if (tree.truncated) fail(503, 'This library is too large to list completely. Use the local sync tool.');
  const pattern = new RegExp(`^submissions/(${uuidPattern})/(${uuidPattern})/metadata\\.json$`);
  const manifests = tree.tree.filter(item => item.type === 'blob' && pattern.test(item.path)).sort((a, b) => a.path.localeCompare(b.path));
  const takes = await Promise.all(manifests.slice(offset, offset + 20).map(async item => {
    const blob = await github(env, `/git/blobs/${item.sha}`);
    const meta = JSON.parse(new TextDecoder().decode(unbase64url(blob.content.replace(/\s/g, ''))));
    const match = item.path.match(pattern);
    if (meta.invite_id !== match[1] || meta.submission_id !== match[2] || typeof meta.voice_name !== 'string' || typeof meta.received_at !== 'string' || !/^original\.(wav|m4a|mp3|webm|ogg|flac)$/.test(meta.audio_file)) fail(502, 'A submission has invalid library metadata. Review it in the private repository.');
    return { invite_id: meta.invite_id, submission_id: meta.submission_id, voice_name: meta.voice_name, transcript: meta.transcript, language: meta.language, audio_file: meta.audio_file, received_at: meta.received_at };
  }));
  return json({ takes, next: offset + 20 < manifests.length ? offset + 20 : null, total: manifests.length });
}
async function previewVoice(request, env) {
  await authorizeReview(request, env);
  const query = new URL(request.url).searchParams;
  const invite = query.get('invite'), id = query.get('id'), file = query.get('file');
  const uuid = new RegExp(`^${uuidPattern}$`);
  if (!uuid.test(invite || '') || !uuid.test(id || '') || !/^original\.(wav|m4a|mp3|webm|ogg|flac)$/.test(file || '')) fail(400, 'Invalid recording path.');
  const response = await fetch(`https://api.github.com/repos/${env.SAMPLES_REPO}/contents/submissions/${invite}/${id}/${file}?ref=${encodeURIComponent(env.SAMPLES_BRANCH || 'main')}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github.raw+json', 'User-Agent': 'voice-actor-intake', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) fail(response.status === 404 ? 404 : 502, 'Could not load this recording. Refresh the library and try again.');
  const types = { wav: 'audio/wav', m4a: 'audio/mp4', mp3: 'audio/mpeg', webm: 'audio/webm', ogg: 'audio/ogg', flac: 'audio/flac' };
  return new Response(response.body, { headers: { ...headers, 'Content-Type': types[file.split('.').pop()], 'Content-Disposition': `inline; filename="${file}"` } });
}
export default {
  async fetch(request, env) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/api/library' && request.method === 'GET') return await listVoices(request, env);
      if (path === '/api/library/audio' && request.method === 'GET') return await previewVoice(request, env);
      if (path === '/api/invite' && request.method === 'GET') {
        const invite = await verifyInvite(request.headers.get('Authorization')?.replace(/^Bearer /, ''), env.INVITE_SECRET);
        return json({ name: invite.name || '', consent: CONSENT_TEXT, consent_version: CONSENT_VERSION });
      }
      if (path === '/api/submit' && request.method === 'POST') return await upload(request, env);
      if (path.startsWith('/api/')) return json({ error: 'Endpoint not found.' }, 404);
      const response = await env.ASSETS.fetch(request);
      const secured = new Response(response.body, response);
      for (const [key, value] of Object.entries(headers)) secured.headers.set(key, value);
      return secured;
    } catch (e) {
      return json({ error: e instanceof HttpError ? e.message : 'Something went wrong. Keep this page open and try again.' }, e instanceof HttpError ? e.status : 500);
    }
  },
};
