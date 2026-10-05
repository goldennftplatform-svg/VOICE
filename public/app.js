/* No analytics, external scripts, or browser-visible GitHub credentials. */
const $ = id => document.getElementById(id);
function cachedToken() { try { return localStorage.getItem('voice-upload-token') || sessionStorage.getItem('voice-invite') || ''; } catch { return ''; } }
let token = new URLSearchParams(location.hash.slice(1)).get('invite') || cachedToken();
function rememberToken() { try { localStorage.setItem('voice-upload-token', token); } catch { /* In-memory upload still works when browser storage is disabled. */ } }
if (token) rememberToken();
// Fragments never reach the server; also remove from the address bar after opening.
history.replaceState(null, '', location.pathname);
let blob, objectURL, recorder, stream, interval, started, sending = false, recording = false;
let submissionId = crypto.randomUUID(), consentVersion;
const message = (text, error = false) => { $('message').textContent = text; $('message').classList.toggle('error', error); };
const releaseMic = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; clearInterval(interval); };
function selectAudio(file) {
  if (objectURL) URL.revokeObjectURL(objectURL);
  blob = file; submissionId = crypto.randomUUID();
  objectURL = URL.createObjectURL(file);
  $('playback').src = objectURL; $('download').href = objectURL;
  $('download').download = file.name || (file.type.includes('mp4') ? 'my-voice.m4a' : file.type.includes('ogg') ? 'my-voice.ogg' : 'my-voice.webm');
  $('file-label').textContent = `${file.name || 'Your recording'} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  $('preview').hidden = false; message('Listen to your take, then check the transcript below.');
}
function clearAudio() {
  blob = null; $('playback').removeAttribute('src'); $('playback').load();
  $('download').removeAttribute('href');
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = null; $('preview').hidden = true; $('audio-file').value = ''; $('timer').textContent = '00:00';
}
$('clear-audio').onclick = () => { clearAudio(); message('Ready for a new take.'); };
$('use-prompt').onclick = () => { $('transcript').value = $('reading-prompt').textContent; message('Prompt added. Adjust the transcript if you change any words.'); };
$('audio-file').onchange = () => {
  const file = $('audio-file').files[0]; if (!file) return;
  if (file.size > 10 * 1024 * 1024 || file.size < 128) { $('audio-file').value = ''; message('Choose a recording smaller than 10 MB, with at least a few seconds of speech.', true); return; }
  selectAudio(file);
};
function finishRecording() {
  if (recorder?.state === 'recording') recorder.stop();
}
$('record').onclick = async () => {
  if (recording) { finishRecording(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { message('This browser cannot record here. Upload a recording from your phone’s voice memo app instead.', true); return; }
  $('record').disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = []; let bytes = 0;
    recorder.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); bytes += event.data.size; if (bytes > 9 * 1024 * 1024) finishRecording(); } };
    recorder.onstop = () => {
      const duration = (Date.now() - started) / 1000;
      const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      recording = false; releaseMic();
      $('record').classList.remove('recording'); $('record').innerHTML = '<span aria-hidden="true">●</span> Record another take';
      $('record-label').textContent = 'YOUR TAKE IS READY'; $('submit').disabled = false; $('audio-file').disabled = false;
      if (duration < 3 || audio.size < 128) { message('That take was too short. Record at least 3 seconds; 15–25 seconds is ideal.', true); return; }
      if (audio.size > 10 * 1024 * 1024) { message('That recording is over 10 MB. Please record a shorter take.', true); return; }
      selectAudio(audio);
    };
    recorder.onerror = () => { finishRecording(); releaseMic(); message('Recording was interrupted. Listen to the preview and re-record if needed.', true); };
    recorder.start(1000); started = Date.now(); recording = true;
    $('playback').pause(); $('record').classList.add('recording'); $('record').innerHTML = '<span aria-hidden="true">■</span> Stop recording';
    $('record-label').textContent = 'RECORDING · KEEP THIS PAGE OPEN'; $('submit').disabled = true; $('audio-file').disabled = true;
    message('Aim for 15–25 seconds for a voice reference. Longer takes stop at 3 minutes.');
    interval = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      if (seconds >= 180) finishRecording();
    }, 250);
  } catch (error) {
    releaseMic();
    message(error.name === 'NotAllowedError' ? 'Microphone access was not allowed. Enable it in your browser settings, or upload a voice memo below.' : 'Could not open the microphone. Close other recording apps, or upload a voice memo below.', true);
  } finally { $('record').disabled = false; }
};
function send(form) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/submit'); xhr.timeout = 180000;
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = event => { if (event.lengthComputable) $('progress').value = event.loaded / event.total * 100; };
    xhr.upload.onload = () => message('Upload received. Saving securely—keep this page open…');
    xhr.onload = () => {
      let result; try { result = JSON.parse(xhr.responseText); } catch { reject(Error('The service did not respond correctly. Your take is still here; try again.')); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(result); else reject(Error(result.error || 'Upload failed. Please try again.'));
    };
    xhr.onerror = xhr.ontimeout = () => reject(Error('Connection interrupted. Your take is still here. Reconnect and press Send again; it will not create a duplicate.'));
    xhr.send(form);
  });
}
$('voice-form').onsubmit = async event => {
  event.preventDefault(); if (sending || recording) return;
  if (!blob) { message('Record or choose an audio file first.', true); $('record').focus(); return; }
  const form = new FormData();
  form.append('audio', blob, 'recording'); form.append('voice_name', $('voice-name').value.trim());
  form.append('transcript', $('transcript').value.trim()); form.append('language', $('language').value.trim());
  form.append('consent', $('consent').checked ? consentVersion : ''); form.append('submission_id', submissionId);
  sending = true; $('fields').disabled = true; $('progress-wrap').hidden = false; $('progress').value = 0; message('Sending your voice…');
  try {
    const result = await send(form);
    $('receipt').textContent = result.receipt; $('voice-form').hidden = true; $('success').hidden = false; $('success').focus();
    blob = null;
  } catch (error) { message(error.message, true); }
  finally { sending = false; $('fields').disabled = false; $('progress-wrap').hidden = true; }
};
$('another').onclick = () => {
  clearAudio(); submissionId = crypto.randomUUID(); $('consent').checked = false;
  $('success').hidden = true; $('voice-form').hidden = false; message('Ready for your next take.'); $('record').focus();
};
window.addEventListener('beforeunload', event => { if (blob || recording || sending) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', releaseMic);
async function init() {
  if (window.voiceRedirecting) return;
  try {
    let response = token ? await fetch('/api/invite', { headers: { Authorization: `Bearer ${token}` } }) : null;
    if (!response || response.status === 401) response = await fetch('/api/session', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    if (data.token) { token = data.token; rememberToken(); }
    $('voice-name').value = data.name; $('consent-text').textContent = data.consent; consentVersion = data.consent_version;
    $('invite-status').textContent = 'Connected to shared storage. Your submitted take will be available to the project team from their own device.';
    $('voice-form').hidden = false;
  } catch (error) { $('invite-status').textContent = error.message || 'Cannot connect to shared storage. Please refresh when connected.'; $('invite-status').classList.add('error'); }
}
init();
