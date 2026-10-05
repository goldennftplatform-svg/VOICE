# VOICE · Private actor recording booth

A phone-friendly link for actors to **name a voice, record or upload a take, review it, and send it**. No actor account or app installation. The site is designed for a small cast of 12–20 voices.

## Connected upload service

**Share this one link with every actor: https://voice-actor-intake.voice-intake.workers.dev/**

They open it on their own phone, enter their voice name, record or choose a file, confirm the transcript/permission, and click **Upload to the team library**. No account or individual invitation is required. A receipt is shown only after the audio and metadata are committed to private GitHub. All devices contribute to the same team collection.

The old GitHub Pages recording URL now redirects to this connected service. The normal recording flow never saves only to browser storage. Reviewers still need a private team link to access the recordings.

Optional pre-named actor invitations remain supported:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/Make-Voice-Links.ps1 -ActorName "Alex"
```

Generate your private team review link (valid for 7 days):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/Make-Voice-Links.ps1
```

Optional actor links last 30 days. The shared URL does not expire: the browser obtains an upload-only session automatically. The helper decrypts the invitation secret for the current Windows user; `.local/` is excluded from Git. To provision or replace storage credentials, run `scripts/Connect-Storage.ps1`; it accepts a hidden GitHub token, configures the Worker secrets, and keeps the invitation secret encrypted with Windows DPAPI. Never commit or share that directory. GitHub token expiry requires running the connection helper with a replacement token.

## Public website

**https://goldennftplatform-svg.github.io/VOICE/**

GitHub Pages redirects to the Cloudflare recording service, including existing actor/reviewer link fragments. Pushes to `public/` automatically update Pages; deploy backend/Cloudflare changes with `npm run deploy`.

### Browse voices by name

Open your private team review link. The default list is **Shared team uploads**: search names, load audio previews, view transcripts, and download submitted takes from every device.

**Recover recordings saved by the old browser-only site:** on the same phone and browser that made them, open **https://goldennftplatform-svg.github.io/VOICE/library.html?local=1**. This explicit recovery page is the only browser-local library. Load/download the old take, then upload that file through the shared URL above. Old local recordings cannot be fetched remotely from somebody else's phone. Do not clear that browser's site data before downloading them.

The **Team uploads** tab is private and requires the deployed Worker. Generate a reviewer link with the same `INVITE_SECRET` used for invitations:

```powershell
node scripts/review-link.mjs https://YOUR-WORKER.workers.dev 7
```

The link expires in 7 days and grants access to all submitted recordings. Keep it within your team. Ordinary actor invitations cannot list or play private submissions. The list loads 20 takes at a time; search filters loaded takes, and **Load more uploads** expands the searchable list. Audio is fetched only when a reviewer requests a preview, through the authenticated Worker; GitHub credentials and private download URLs never reach the browser. Private files are not published to GitHub Pages.

**Code:** `goldennftplatform-svg/VOICE` (public). **Audio:** `goldennftplatform-svg/VOICE-samples` (private). GitHub Pages alone cannot securely accept recordings; a Cloudflare Worker serves this site and writes submissions to GitHub using a server-side secret.

## Preview locally now

Double-click **`Preview-Website.cmd`**, or run `npm run preview`. Open the invitation URL printed in the terminal. Recording, file selection, transcript entry, and playback work; sending is explicitly disabled. No GitHub or Cloudflare credentials are needed for this local preview. Close the terminal to stop it. This localhost preview is for your computer; actors need the deployed HTTPS URL.

## One-time free hosting setup

Cloudflare Workers has a free plan and supplies an HTTPS `workers.dev` address. No domain purchase is needed. Free-plan resource/request limits apply; test representative phone recordings before inviting the cast. This is a small-cast intake service, not a large audio hosting platform. GitHub free private repositories hold the samples.

1. Create a free account at https://dash.cloudflare.com/sign-up.
2. Open a terminal in this repository:
   ```powershell
   npm ci
   npx wrangler login
   ```
3. Create a **fine-grained GitHub personal access token**, restricted to **VOICE-samples**, with **Contents: Read and write**. Keep the token out of source code, the website, and chat. Set it interactively:
   ```powershell
   npx wrangler secret put GITHUB_TOKEN
   ```
4. Generate a random secret (32+ characters) with your password manager, save it securely, and set it:
   ```powershell
   npx wrangler secret put INVITE_SECRET
   ```
   If prompted to create the Worker, accept. `wrangler.jsonc` already names the private repository and its `main` branch. The sample repo must have an initial commit (a README is enough).
5. Publish:
   ```powershell
   npm run deploy
   ```
   Wrangler prints the HTTPS website address. Use that address in the next step. Subsequent deployments use the same command.

## Send invitations

Set `INVITE_SECRET` in your **local terminal environment** to the same secret stored in Cloudflare. Then:

```powershell
npm run invite -- https://voice-actor-intake.YOUR-SUBDOMAIN.workers.dev "Alex" 30
```

These invitations are optional; the bare shared URL already supports submission. A pre-named invitation expires in 30 days. Use the same name and browser/link for an actor's additional takes. The upload session/invitation plus normalized name generates a separate speaker ID; this prevents two names using one phone from entering the same training folder. Different devices with identical display names remain separate speaker IDs until the operator explicitly reconciles them.

Invitation tokens are initially in the URL fragment, not server URLs/logs. Upload-only tokens are retained in local storage when available; audio itself is not. Session creation and uploads are limited to 10 attempts/minute/IP, with a separate per-session upload limit. These are basic rate limits, not bot verification or lifetime quotas. `PUBLIC_INTAKE=true` enables the shared link; set it to `false` and redeploy to disable automatic session issuance while retaining unexpired invitations/sessions. Rotating `INVITE_SECRET` invalidates existing actor and reviewer tokens; with public intake enabled, actors can obtain new upload-only sessions. Per-invitation revocation is not implemented.

## Actor experience

1. Open the shared website link in Safari or Chrome (use “Open in browser” if a messaging app blocks microphone access).
2. Enter a voice/character name.
3. Record about **15–25 seconds**, or upload a voice memo. In-browser recording stops at 3 minutes. Supported containers: WAV, M4A/MP4, MP3, WebM, OGG, FLAC; max 10 MB.
4. Listen back. Use the provided prompt's text or enter the exact words spoken.
5. Confirm permission for private storage, local AI voice cloning/training, and generated speech. Click **Upload to the team library** and wait for **Your voice is in the team library** plus the receipt.

Audio stays in browser memory until upload; actors can save a copy before sending. A network retry uses the same receipt so a successful-but-disconnected upload does not duplicate. Reloading can lose an unsent recording. Upload success means GitHub saved the files, not that audio quality or transcript accuracy passed review.

## Local VoiceAgent integration

On this workstation the checkout belongs at:

```text
C:\Users\PreSafu\Desktop\VoiceAgent\voice-intake
```

Requirements: Python 3.10+, `gh` authenticated to the private repo, `git`, and `ffmpeg` on PATH. Download and prepare:

```powershell
python scripts/voice_library.py sync
python scripts/voice_library.py list
```

From the existing VoiceAgent folder, the installed shortcut is:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync_voice_intake.ps1
```

For a different installation:

```powershell
python scripts/voice_library.py --root "D:\VoiceAgent" sync
```

Output follows the existing Character Studio `data/training/<speaker>/voice` convention:

```text
VoiceAgent/data/training/
  _voice_intake/
    repository/                 # private Git checkout; originals and metadata
    library.json                # all successfully prepared takes
    dataset.jsonl               # one audio/text/speaker row per take
    backups/                    # created before explicit mode installation
  actor_<speaker-uuid>/voice/<receipt>/
    original.m4a                # original extension retained
    sample.wav                  # 24 kHz, mono, signed 16-bit PCM
    transcript.txt
    metadata.json               # consent, timestamps, checksum, identity
```

Conversion checks original checksums, decodes locally, and rejects durations outside 3–180 seconds. It does **not** trim audio while retaining an incorrect full transcript. Takes over 45 seconds are retained for dataset preparation but cannot be installed as cloning references. Re-sync rebuilds the index from current valid submissions; already-written local files and Git history are retained. Deleting files from GitHub does not automatically erase local copies or Git history.

### Use any of the 12–20 voices in scripts

Every actor is available by receipt, even if they do not have a built-in VoiceAgent mode. Start your existing Qwen3-TTS Pinokio app and run with the VoiceAgent virtual environment:

```powershell
..\.venv\Scripts\python.exe scripts/voice_library.py speak RECEIPT_UUID --text "Welcome to our next story." --output "..\data\generated\alex-test.wav"
```

This calls the existing `PinokioTTSClient.generate_voice_clone` with the actor's WAV, exact transcript, and language. You can also read `library.json` in your own scripts.

### Assign a voice to an existing character mode

```powershell
..\.venv\Scripts\python.exe scripts/voice_library.py install RECEIPT_UUID --mode pauly --replace
```

Uses the existing `voice_setup.install_voice_sample`, writes `voice_samples/pauly/reference.wav`, and updates `config.yaml` with the transcript. An existing reference requires `--replace`; the previous mode folder and config are backed up first. Restart/reload the running voice app afterward. This command supports existing `VoiceMode` names; it does not add new enum-based UI characters. The `speak` command supports all imported actors without this limitation.

### Cloning vs. fine-tuning

A short clean reference is enough to try **Qwen3 zero-shot voice cloning**; it is not a fully fine-tuned model. `dataset.jsonl` is a model-neutral source manifest, **not** a promise of compatibility with every trainer. Fine-tuning still needs transcript review, segmentation/alignment, enough varied speech per actor, and conversion to the selected trainer's dataset schema. Collect additional takes using each actor's link; originals are preserved.

## Data and implementation notes

- The browser never receives the GitHub token and cannot list/download other actors' submissions.
- The backend checks repository privacy on every submission and refuses public storage.
- Container signatures are checked on upload; authoritative audio decoding happens locally. Files are not automatically executed. Do not treat upload validation as an audio-quality or malware scan.
- Audio and metadata enter a single Git commit. Non-forced branch updates retry if actors upload simultaneously.
- Metadata includes the exact consent wording/version, receipt, invitation ID, name, transcript, language, timestamp, byte count, and SHA-256. No IP address or email is stored in submission metadata.
- Do not add actors as repository collaborators; share the recording website URL instead.
- For removal, search by receipt and coordinate deletion of current files, local copies, derived models, and Git history as appropriate. Removing the current file alone does not purge history.
- No automated training or live GPU changes occur on upload.

## Development and verification

Copy `.dev.vars.example` to `.dev.vars`, fill in development secrets, then `npm run dev`. Use a dedicated private test repo for live upload testing. Never commit `.dev.vars`.

```powershell
npm test
python -m unittest discover -s tests -p "test_*.py"
npx wrangler deploy --dry-run
```

Tests cover invitation signatures/expiry, consent, request limits, container rejection, private-repo enforcement, atomic storage conflicts/idempotency, local checksum/path validation, and real ffmpeg normalization. Before sending invitations, perform a real iPhone/Android recording → private GitHub → local sync → listening test. Microphone permission and mobile codec behavior require a device check.
