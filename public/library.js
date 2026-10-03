const $ = id => document.getElementById(id);
const pages = location.hostname.endsWith('.github.io');
const incoming = new URLSearchParams(location.hash.slice(1)).get('review');
if (incoming) sessionStorage.setItem('voice-review', incoming);
history.replaceState(null, '', location.pathname);
const token = sessionStorage.getItem('voice-review') || '';
let mode = incoming ? 'team' : 'local', takes = [], next = null, generation = 0;
const urls = new Set();
const status = text => { $('library-status').textContent = text; };
function cleanup() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
async function api(path) {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    let data; try { data = await response.json(); } catch { /* non-JSON service failure */ }
    throw Error(data?.error || 'Could not load the private library. Please try again.');
  }
  return response;
}
function text(tag, value, className) {
  const element = document.createElement(tag); element.textContent = value;
  if (className) element.className = className;
  return element;
}
function attachAudio(card, take, blob, playButton) {
  const url = URL.createObjectURL(blob); urls.add(url);
  const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = url;
  audio.setAttribute('aria-label', `Preview ${take.voice_name}`);
  audio.onplay = () => document.querySelectorAll('audio').forEach(other => { if (other !== audio) other.pause(); });
  const link = text('a', 'Download audio', 'text-button'); link.href = url; link.download = take.filename || take.audio_file || 'voice-recording';
  card.querySelector('.voice-actions').prepend(link); playButton.replaceWith(audio);
}
function render() {
  cleanup(); $('voice-list').replaceChildren();
  const query = $('search').value.trim().toLocaleLowerCase();
  const filtered = takes.filter(take => take.voice_name.toLocaleLowerCase().includes(query));
  filtered.sort((a, b) => a.voice_name.localeCompare(b.voice_name) || b.received_at.localeCompare(a.received_at));
  status(takes.length ? `${filtered.length} of ${takes.length} loaded takes${next !== null ? ' · Load more to search additional uploads' : ''}` : (mode === 'local' ? 'No saved voices yet. Record a take, enter its name, then save it to your Voice Library.' : 'No uploaded voices yet.'));
  for (const take of filtered) {
    const card = document.createElement('article'); card.className = 'voice-card';
    card.append(text('h2', take.voice_name));
    card.append(text('p', `${take.language || 'English'} · ${new Date(take.received_at).toLocaleString()} · ${mode === 'local' ? 'Saved on this browser' : 'Private team upload'}`, 'take-meta'));
    const play = text('button', 'Load preview ▶', 'record-button'); play.type = 'button'; card.append(play);
    if (take.transcript) { const details = document.createElement('details'); details.append(text('summary', 'Transcript'), text('p', take.transcript, 'transcript')); card.append(details); }
    const actions = document.createElement('div'); actions.className = 'voice-actions'; card.append(actions);
    card.append(text('p', `Take: ${take.id || take.submission_id}`, 'receipt-id'));
    $('voice-list').append(card);
    play.onclick = async () => {
      play.disabled = true; const current = generation;
      try {
        const blob = mode === 'local' ? take.audio : await (await api(`/api/library/audio?invite=${encodeURIComponent(take.invite_id)}&id=${encodeURIComponent(take.submission_id)}&file=${encodeURIComponent(take.audio_file)}`)).blob();
        if (current !== generation || !card.isConnected) return;
        attachAudio(card, take, blob, play);
      } catch (error) { play.disabled = false; play.textContent = 'Retry preview ▶'; const old = card.querySelector('.card-error'); if (old) old.remove(); card.append(text('p', error.message, 'card-error')); }
    };
    if (mode === 'local') {
      const rename = text('button', 'Rename', 'text-button'); rename.type = 'button';
      rename.onclick = async () => {
        const name = prompt('Voice name', take.voice_name)?.trim();
        if (!name) return;
        if (name.length < 2 || name.length > 60) { status('Use a name between 2 and 60 characters.'); return; }
        try { await window.voiceLibraryStore.save({ ...take, voice_name: name }); await load(); } catch { status('Could not rename this take.'); }
      };
      const remove = text('button', 'Remove from this browser', 'text-button'); remove.type = 'button';
      remove.onclick = async () => {
        if (!confirm(`Remove ${take.voice_name} from this browser? Download a copy first if you need it.`)) return;
        try { await window.voiceLibraryStore.remove(take.id); await load(); } catch { status('Could not remove this take.'); }
      };
      actions.append(rename, remove);
    }
  }
}
async function load(append = false) {
  const current = ++generation; $('load-more').hidden = true;
  if (!append) { takes = []; next = null; cleanup(); $('voice-list').replaceChildren(); }
  $('local-tab').setAttribute('aria-pressed', mode === 'local'); $('team-tab').setAttribute('aria-pressed', mode === 'team');
  $('library-notice').textContent = mode === 'local' ? 'These takes are stored only in this browser, not uploaded or shared across devices. Download backups before clearing browser data.' : 'Private submissions are visible only through a team review link. Actor invitation links cannot open this library.';
  if (mode === 'team' && pages) { status('Team uploads are not connected on GitHub Pages yet. The private library will be available through your team review link once the upload service is deployed.'); return; }
  if (mode === 'team' && !token) { status('Open the private team review link from your project administrator to see uploaded voices.'); return; }
  status('Loading voices…');
  try {
    let rows, nextPage = null;
    if (mode === 'local') rows = await window.voiceLibraryStore.all();
    else { const data = await (await api(`/api/library?offset=${append ? next : 0}`)).json(); rows = data.takes; nextPage = data.next; }
    if (current !== generation) return;
    takes = append ? [...takes, ...rows] : rows; next = nextPage; render(); $('load-more').hidden = next === null;
  } catch (error) { if (current === generation) { status(error.message || 'Could not load browser storage.'); $('load-more').hidden = next === null; } }
}
$('local-tab').onclick = () => { mode = 'local'; load(); };
$('team-tab').onclick = () => { mode = 'team'; load(); };
$('refresh').onclick = () => load();
$('load-more').onclick = () => load(true);
$('search').oninput = () => { if (takes.length) render(); };
window.addEventListener('pagehide', cleanup);
load();
