// Old shared links must reach real cloud uploads, never a browser-only save form.
window.voiceRedirecting = false;
if (location.hostname.endsWith('.github.io')) {
  const library = /\/library(?:\.html)?\/?$/.test(location.pathname);
  const recover = library && new URLSearchParams(location.search).get('local') === '1';
  if (!recover) {
    window.voiceRedirecting = true;
    const target = new URL(library ? '/library' : '/', 'https://voice-actor-intake.voice-intake.workers.dev');
    target.hash = location.hash;
    location.replace(target.href);
  }
}
