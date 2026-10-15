# Public listening room

Share **https://goldennftplatform-svg.github.io/VOICE/preview/**.

This page contains only deliberately published finished MP3 performances and their spoken scripts. Actor reference recordings, private submissions, permission records, credentials, local paths, and the full production manuscript are not included.

## What listeners can do

- Play each scene on a phone or computer; starting another preview pauses the first.
- Give a thumbs up or down, change it, or tap the selected direction to remove it.
- Share the page or a link straight to a particular scene.
- Search by scene, room, or voice; open the transcript for accessibility.

Votes persist in Cloudflare D1 (`voice-preview-votes`) and are shared across devices. They are not stored in a browser-only counter. A hashed random browser ID identifies the voter's selection; no name, account, email, or IP address is stored in the vote table. This is informal feedback, not verified one-person voting: clearing local storage/using another browser creates another identity. Writes are rate-limited and duplicate submissions update the existing selection atomically.

## Add another finished recording

From this repository:

```powershell
python scripts/publish_preview.py add "C:\path\new-scene.mp3" --title "New Scene" --voice "Narrator voice" --room "Library" --transcript "C:\path\spoken-words.txt"
```

`--transcript` is optional. The script checks MP3 decoding and duration, copies only that MP3 into `public/preview/audio/`, and updates `public/preview/catalog.json`. It never copies raw actor references or secrets. IDs include the audio hash, so a changed recording gets its own votes rather than inheriting feedback for an older performance. Re-adding identical audio with the same source stem updates its labels without duplicating the preview.

Publish the staged preview:

```powershell
git add public/preview
git commit -m "Add new voice preview"
git push origin main
```

GitHub Pages deploys automatically. The voting service reads the public catalog from GitHub, with a short cache, so adding clips normally requires **no Cloudflare redeployment or configuration**. Allow the Pages build/cache to finish before sharing a newly added clip. Remove an old revision from the catalog to hide it; votes remain stored for that ID. Deleting a file from the current branch does not purge Git history.

## Initial publication

The five complete Meeker Mansion scenes are published: Talking Head, Yellow Parlor, Hair Wreath (one-button full version), Tea in the Parlor, and Funeral Narrator. Split performer cues remain in the local production pack. Future scenes can be added with the command above.

## Original-versus-AI comparisons

**https://goldennftplatform-svg.github.io/VOICE/preview/?compare=dar-matron** shows the selected original actor excerpt and a generated clone reading the same passage, with measured duration, integrated loudness, true peak, speaking rate and automatic text checking. The cloning reference uses an earlier, non-overlapping passage. Likeness is judged by listening, not inferred from a text-match percentage.

This comparison deliberately publishes only the selected, level-matched original excerpt and generated excerpt, as requested by the project owner. The full submitted takes, consent metadata, reference audio, source IDs and filesystem paths remain private. The personal speaker name is not inferred from a role-only upload label.

To stage another prepared comparison report:

```powershell
python scripts/publish_preview.py comparison "C:\path\comparison_report.json" --id dar-matron --title "DAR Matron"
```

Then commit/push `public/preview` as above. The existing vote API supports the two new catalog IDs without a schema change.

## Voting service maintenance

The Worker binds `PREVIEW_DB` to D1. Apply schema updates with:

```powershell
npx wrangler d1 migrations apply voice-preview-votes --remote
npm run deploy
```

Only the known GitHub Pages origin and the Worker's own origin can send browser votes. Vote IDs are limited to published catalog entries. Existing private actor upload/review routes retain their separate behavior. Static preview audio and website files are served by GitHub Pages; the vote API is Cloudflare-hosted.

Tests in `tests/preview-votes.test.js` exercise real SQLite statements for idempotency, change/remove behavior, totals across visitors, validation, CORS and unavailable-storage errors.
