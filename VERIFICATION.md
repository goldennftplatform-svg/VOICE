# Local verification

Checked on this Windows workstation during implementation:

- 9 Node tests pass: invitation authentication/expiry, supported containers, consent and request validation, size/rate limits, private storage enforcement, atomic Git updates and duplicate retries, isolated public upload-only sessions, reviewer-only library access, paginated listing and authenticated audio proxying.
- 3 Python tests pass: path/checksum rejection, named speaker identity, and actual ffmpeg conversion from stereo 16 kHz to mono 24 kHz PCM, original preservation, transcript preservation, repeatability.
- Cloudflare deployment dry-run bundles successfully.
- Local Worker runtime starts and verifies a signed invitation.
- Chromium at 390 × 844: form fits without horizontal overflow; upload preview, prompt-to-transcript, consent, error recovery, and new-take reset verified.
- Chromium native MediaRecorder exercised with a synthetic audio stream: start/stop creates a playable blob; submit stays disabled during recording and becomes available afterward.
- Missing server credentials produce an actionable error while retaining the recording for retry.
- Browser receipt/success state verified using a mocked upload response. GitHub write semantics are tested against mocked GitHub API responses.
- Cloudflare is deployed at `https://voice-actor-intake.voice-intake.workers.dev` with GitHub and invitation secrets configured.
- A generated four-second WAV was uploaded through the live website, committed to private GitHub, listed by name in the authenticated team library, fetched as playable four-second audio, and imported locally as 24 kHz mono PCM.
- The synthetic verification take was then removed from the current private repository, and local sync rebuilt an empty active dataset. Its Git history and previously downloaded local test files remain; no actor voice was used in this test.
- GitHub Pages library save, persistence, search, audio loading, rename and remove were verified in a mobile-sized browser.
- The shared-link workflow was verified using two fresh, isolated mobile-sized browser contexts with no invitation or shared cookies/storage. Both opened the bare Worker URL and uploaded generated four-second tones. A separate authenticated reviewer saw both names and loaded both audio previews. Local sync prepared both recordings successfully. These are browser-isolation tests, not physical phone tests.
- The old public Pages recording flow now redirects to the Worker. Legacy local recordings remain recoverable at `library.html?local=1` on their original browser.

Not yet verified: real iPhone/Android microphone behavior, larger recordings against the free-plan resource limits, or live Qwen3 generation using a submitted actor. The successful hosted test used generated audio, not a human voice.
