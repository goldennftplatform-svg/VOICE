# Local verification

Checked on this Windows workstation during implementation:

- 6 Node tests pass: invitation authentication/expiry, supported containers, consent and request validation, size/rate limits, private storage enforcement, atomic Git updates and duplicate retries.
- 2 Python tests pass: path/checksum rejection and actual ffmpeg conversion from stereo 16 kHz to mono 24 kHz PCM, original preservation, transcript preservation, repeatability.
- Cloudflare deployment dry-run bundles successfully.
- Local Worker runtime starts and verifies a signed invitation.
- Chromium at 390 × 844: form fits without horizontal overflow; upload preview, prompt-to-transcript, consent, error recovery, and new-take reset verified.
- Chromium native MediaRecorder exercised with a synthetic audio stream: start/stop creates a playable blob; submit stays disabled during recording and becomes available afterward.
- Missing server credentials produce an actionable error while retaining the recording for retry.
- Browser receipt/success state verified using a mocked upload response. GitHub write semantics are tested against mocked GitHub API responses.
- Private `VOICE-samples` repository was created and real local sync successfully cloned its initial README. No actor recordings have been uploaded.

Not yet verified: real iPhone/Android microphone behavior, deployed Cloudflare secrets/resource limits, real upload-to-GitHub from the hosted endpoint, or live Qwen3 generation using a submitted actor. These need hosting credentials and a real test take. Website hosting has not yet been deployed.
