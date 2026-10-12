const $ = id => document.getElementById(id);
const CANONICAL = 'https://goldennftplatform-svg.github.io/VOICE/preview/';
const API = location.hostname.endsWith('.github.io') ? 'https://voice-actor-intake.voice-intake.workers.dev/api/preview/votes' : '/api/preview/votes';
let visitor, clips = [], votes = {}, votingReady = false, refreshing = false;
const cards = new Map(), pending = new Set();
try {
  visitor = localStorage.getItem('voice-preview-voter');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(visitor || '')) {
    visitor = crypto.randomUUID(); localStorage.setItem('voice-preview-voter', visitor);
  }
} catch { visitor = crypto.randomUUID(); }
function element(tag, content, className) {
  const item = document.createElement(tag); item.textContent = content;
  if (className) item.className = className;
  return item;
}
function status(text, error = false) { $('page-status').textContent = text; $('page-status').classList.toggle('error', error); }
async function api(options) {
  const response = await fetch(options ? API : `${API}?visitor=${encodeURIComponent(visitor)}`, { cache: 'no-store', ...options });
  let body; try { body = await response.json(); } catch { throw Error('Voting is temporarily unavailable. Audio still works.'); }
  if (!response.ok) throw Error(body.error || 'Could not save your vote. Please try again.');
  return body;
}
function updateCard(id) {
  const controls = cards.get(id); if (!controls) return;
  const current = votes[id] || { up: 0, down: 0, mine: 0 };
  for (const [value, button] of [[1, controls.up], [-1, controls.down]]) {
    button.setAttribute('aria-pressed', String(current.mine === value));
    button.querySelector('strong').textContent = String(value === 1 ? current.up : current.down);
    button.disabled = !votingReady || refreshing || pending.has(id);
  }
}
async function vote(id, direction) {
  if (!votingReady || refreshing || pending.has(id)) return;
  pending.add(id); updateCard(id);
  const card = cards.get(id); card.note.textContent = 'Saving your vote online…';
  const value = votes[id]?.mine === direction ? 0 : direction;
  try {
    const result = await api({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clip_id: id, visitor, value }) });
    votes[id] = result;
    card.note.textContent = value === 0 ? 'Your vote was removed.' : 'Vote saved online. Thanks for listening!';
  } catch (error) { card.note.textContent = error.message; }
  finally { pending.delete(id); updateCard(id); }
}
async function share(clip) {
  const url = new URL(CANONICAL); if (clip) url.hash = `clip=${encodeURIComponent(clip.id)}`;
  try {
    if (navigator.share) await navigator.share({ title: clip ? `${clip.title} · Meeker Mansion` : 'Meeker Mansion voice previews', url: url.href });
    else {
      await navigator.clipboard.writeText(url.href);
      $('share-status').textContent = 'Link copied. Paste it into a text, email, or group chat.';
      if (clip) cards.get(clip.id).note.textContent = 'Clip link copied—ready to share.';
      else status('Page link copied—paste it into a text, email, or group chat.');
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('share-fallback').hidden = false; $('share-url').value = url.href; $('share-url').focus(); $('share-url').select();
    $('share-status').textContent = 'Copy the link above to share it.';
  }
}
function render() {
  $('clips').replaceChildren(); cards.clear();
  for (const [index, clip] of clips.entries()) {
    const card = element('article', '', 'clip'); card.id = `clip-${clip.id}`;
    const top = element('div', '', 'clip-top'), heading = element('div', '');
    heading.append(element('p', `${String(index + 1).padStart(2, '0')} · ${clip.room}`, 'eyebrow'), element('h2', clip.title), element('p', clip.voice, 'voice'));
    const seconds = Math.round(clip.duration_seconds); top.append(heading, element('span', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, 'duration'));
    card.append(top);
    const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = `./audio/${encodeURIComponent(clip.filename)}`;
    audio.setAttribute('aria-label', `Play ${clip.title}`);
    audio.onplay = () => document.querySelectorAll('audio').forEach(other => { if (other !== audio) other.pause(); });
    audio.onerror = () => { note.textContent = 'Could not load this recording. Refresh and try again.'; };
    card.append(audio);
    const actions = element('div', '', 'actions');
    function button(value, label, emoji) {
      const b = element('button', '', 'vote'); b.type = 'button'; b.disabled = true; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', `${value === 1 ? 'Upvote' : 'Downvote'}: ${clip.title}`);
      b.append(element('span', emoji, 'emoji'), element('span', label), element('strong', '0'));
      b.onclick = () => vote(clip.id, value); return b;
    }
    const up = button(1, 'Works for me', '👍'), down = button(-1, 'Another take', '👎');
    const shareButton = element('button', 'Share clip ↗', 'outline clip-share'); shareButton.type = 'button'; shareButton.onclick = () => share(clip);
    actions.append(up, down, shareButton); card.append(actions);
    const note = element('p', '', 'clip-status'); note.setAttribute('aria-live', 'polite'); card.append(note);
    if (clip.transcript) { const details = document.createElement('details'); details.append(element('summary', 'Read the script'), element('p', clip.transcript)); card.append(details); }
    cards.set(clip.id, { card, up, down, note }); $('clips').append(card);
  }
}
async function refreshVotes() {
  if (pending.size) return;
  refreshing = true; clips.forEach(clip => updateCard(clip.id));
  $('refresh-votes').disabled = true;
  try {
    const data = await api(); votes = data.votes; votingReady = true;
    status('Voting is connected. Your feedback is saved online.');
  } catch (error) { votingReady = false; status(error.message, true); }
  finally { refreshing = false; $('refresh-votes').disabled = false; clips.forEach(clip => updateCard(clip.id)); }
}
function filter() {
  const query = $('search').value.toLocaleLowerCase().trim(); let visible = 0;
  for (const clip of clips) { const show = `${clip.title} ${clip.voice} ${clip.room}`.toLocaleLowerCase().includes(query); cards.get(clip.id).card.hidden = !show; if (show) visible++; }
  $('empty').hidden = visible !== 0;
}
function jumpToClip() {
  const id = new URLSearchParams(location.hash.slice(1)).get('clip');
  if (id && cards.has(id)) { $('search').value = ''; filter(); cards.get(id).card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
$('share-page').onclick = () => share(); $('search').oninput = filter; $('refresh-votes').onclick = refreshVotes;
window.addEventListener('hashchange', jumpToClip);
async function init() {
  try {
    const response = await fetch('./catalog.json', { cache: 'no-store' });
    if (!response.ok) throw Error('Previews are being published. Please refresh shortly.');
    const data = await response.json();
    clips = data.clips.filter(clip => /^[a-z0-9][a-z0-9_-]{0,119}$/.test(clip.id) && /^[a-z0-9_-]+\.mp3$/.test(clip.filename));
    $('clip-count').textContent = `${clips.length} scene${clips.length === 1 ? '' : 's'} to preview`;
    render(); filter(); jumpToClip(); await refreshVotes();
  } catch (error) { status(error.message || 'Could not load previews. Please refresh.', true); }
}
init();
