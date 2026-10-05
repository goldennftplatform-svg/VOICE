#!/usr/bin/env python3
"""Private GitHub intake -> local training library -> existing VoiceAgent / Qwen3.

Sync/prepare use only Python stdlib, git, gh, and ffmpeg. Install/speak use
VoiceAgent's existing virtual environment. Originals and transcripts stay intact.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

DEFAULT_REPO = "goldennftplatform-svg/VOICE-samples"
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")


def run(args: list[str], **kwargs) -> str:
    result = subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)
    return result.stdout.strip()


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(path)


def library_path(root: Path) -> Path:
    return root / "data" / "training" / "_voice_intake" / "library.json"


def sync(root: Path, repo: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("Expected an owner/repository name")
    details = json.loads(run(["gh", "repo", "view", repo, "--json", "isPrivate"]))
    if not details["isPrivate"]:
        raise ValueError("Samples repository must be private")
    checkout = root / "data" / "training" / "_voice_intake" / "repository"
    checkout.parent.mkdir(parents=True, exist_ok=True)
    if checkout.exists():
        origin = run(["git", "-C", str(checkout), "remote", "get-url", "origin"])
        if origin.removesuffix(".git") not in (f"https://github.com/{repo}", f"git@github.com:{repo}"):
            raise ValueError("Existing checkout origin does not match the samples repository")
        if run(["git", "-C", str(checkout), "status", "--porcelain"]):
            raise ValueError("Intake checkout has local changes. Preserve them before syncing.")
        run(["git", "-C", str(checkout), "pull", "--ff-only"], timeout=180)
    else:
        run(["gh", "repo", "clone", repo, str(checkout)], timeout=180)
    return checkout


def validate_metadata(path: Path) -> tuple[dict, Path]:
    meta = json.loads(path.read_text(encoding="utf-8"))
    if meta.get("schema_version") != 1 or not UUID.fullmatch(meta.get("submission_id", "")):
        raise ValueError("Unsupported metadata or invalid receipt")
    if not UUID.fullmatch(meta.get("invite_id", "")):
        raise ValueError("Invalid actor invitation ID")
    if "speaker_id" in meta and not UUID.fullmatch(meta["speaker_id"]):
        raise ValueError("Invalid speaker ID")
    if path.parent.name != meta["submission_id"] or path.parent.parent.name != meta["invite_id"]:
        raise ValueError("Metadata does not match submission directory")
    if not meta.get("consent", {}).get("accepted") or meta["consent"].get("version") != "2026-10-02":
        raise ValueError("Missing supported voice-use permission")
    if not isinstance(meta.get("transcript"), str) or not 10 <= len(meta["transcript"]) <= 12000:
        raise ValueError("Missing or invalid transcript")
    if not isinstance(meta.get("voice_name"), str) or not 2 <= len(meta["voice_name"]) <= 60:
        raise ValueError("Missing or invalid voice name")
    if not re.fullmatch(r"original\.(wav|m4a|mp3|webm|ogg|flac)", meta.get("audio_file", "")):
        raise ValueError("Invalid audio filename")
    audio = path.parent / meta["audio_file"]
    if audio.is_symlink() or audio.resolve().parent != path.parent.resolve():
        raise ValueError("Audio must be a regular file inside its submission")
    if not 128 <= audio.stat().st_size <= 10 * 1024 * 1024 or audio.stat().st_size != meta.get("bytes"):
        raise ValueError("Recording size mismatch")
    if hashlib.sha256(audio.read_bytes()).hexdigest() != meta.get("sha256"):
        raise ValueError("Recording checksum mismatch")
    return meta, audio


def prepare(root: Path, checkout: Path) -> tuple[list[dict], list[str]]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("ffmpeg is required on PATH to decode phone recordings")
    entries, errors = [], []
    for manifest in sorted((checkout / "submissions").glob("*/*/metadata.json")):
        try:
            meta, audio = validate_metadata(manifest)
            # New sessions separate different names on a shared phone; legacy
            # invitations remain importable without rewriting their metadata.
            speaker = "actor_" + meta.get("speaker_id", meta["invite_id"])
            dest = root / "data" / "training" / speaker / "voice" / meta["submission_id"]
            dest.mkdir(parents=True, exist_ok=True)
            wav = dest / "sample.wav"
            with tempfile.TemporaryDirectory(prefix="voice-decode-") as scratch:
                decoded = Path(scratch) / "sample.wav"
                # Local-only protocols: uploaded playlists cannot fetch URLs or other files.
                # Decode a bounded 181s, then reject >180s; never silently trim transcripts.
                run([ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-i", str(audio), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-t", "181", str(decoded)], timeout=120)
                with wave.open(str(decoded), "rb") as recording:
                    duration = recording.getnframes() / recording.getframerate()
                    if not 3 <= duration <= 180:
                        raise ValueError(f"Duration {duration:.1f}s is outside 3–180 seconds; request a new take")
                shutil.copyfile(decoded, wav)
            shutil.copyfile(audio, dest / meta["audio_file"])
            write_json(dest / "metadata.json", meta)
            (dest / "transcript.txt").write_text(meta["transcript"] + "\n", encoding="utf-8")
            entry = {"submission_id": meta["submission_id"], "speaker": speaker, "voice_name": meta["voice_name"], "audio": str(wav.resolve()), "text": meta["transcript"], "language": meta.get("language", "English"), "duration_seconds": round(duration, 3), "reference_ready": duration <= 45, "sha256_original": meta["sha256"], "metadata": str((dest / "metadata.json").resolve())}
            entries.append(entry)
            print(f"Prepared {meta['voice_name']}: {duration:.1f}s [{meta['submission_id']}]")
        except (ValueError, OSError, subprocess.SubprocessError, wave.Error, KeyError, TypeError) as exc:
            errors.append(f"{manifest}: {exc}")
    write_json(library_path(root), {"schema_version": 1, "samples": entries, "errors": errors})
    dataset = library_path(root).with_name("dataset.jsonl")
    dataset.write_text("".join(json.dumps(entry, ensure_ascii=False) + "\n" for entry in entries), encoding="utf-8")
    print(f"\n{len(entries)} prepared, {len(errors)} rejected. Library: {library_path(root)}")
    return entries, errors


def find_sample(root: Path, receipt: str) -> dict:
    entries = json.loads(library_path(root).read_text(encoding="utf-8"))["samples"]
    matches = [entry for entry in entries if entry["submission_id"] == receipt]
    if len(matches) != 1:
        raise ValueError("Receipt not found. Run sync, then list to choose a complete receipt.")
    entry = matches[0]
    if not entry["reference_ready"]:
        raise ValueError("This take is longer than 45 seconds. Record a short reference take, or create a matching audio/text segment before cloning. The full take remains in the dataset.")
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2], help="VoiceAgent directory (containing config.yaml)")
    sub = parser.add_subparsers(dest="command", required=True)
    sync_parser = sub.add_parser("sync", help="Pull private samples and prepare local training packs")
    sync_parser.add_argument("--repo", default=DEFAULT_REPO)
    prepare_parser = sub.add_parser("prepare", help="Prepare an already-downloaded samples checkout")
    prepare_parser.add_argument("checkout", type=Path)
    sub.add_parser("list", help="Show local voices and receipts")
    install = sub.add_parser("install", help="Install a reference into an existing VoiceAgent mode")
    install.add_argument("receipt")
    install.add_argument("--mode", required=True)
    install.add_argument("--replace", action="store_true", help="Explicitly replace a mode's existing reference (backs it up first)")
    speak = sub.add_parser("speak", help="Generate speech with ANY imported voice using local Pinokio Qwen3")
    speak.add_argument("receipt")
    speak.add_argument("--text", required=True)
    speak.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if not (root / "config.yaml").is_file():
        parser.error("--root must point to your VoiceAgent folder containing config.yaml")
    if args.command in ("sync", "prepare"):
        checkout = sync(root, args.repo) if args.command == "sync" else args.checkout.resolve()
        _, errors = prepare(root, checkout)
        for error in errors:
            print(error, file=sys.stderr)
        return 1 if errors else 0
    if args.command == "list":
        for item in json.loads(library_path(root).read_text(encoding="utf-8"))["samples"]:
            print(f"{item['submission_id']}  {item['voice_name']}  {item['duration_seconds']}s  {'reference ready' if item['reference_ready'] else 'long training take'}")
        return 0
    sample = find_sample(root, args.receipt)
    sys.path.insert(0, str(root))
    if args.command == "install":
        from datetime import datetime, timezone
        from voice_profiles import VoiceMode
        from voice_setup import install_voice_sample

        mode = VoiceMode.from_string(args.mode).value
        dest = root / "voice_samples" / mode / "reference.wav"
        if dest.exists() and not args.replace:
            raise ValueError("This mode already has audio. Use --replace to back it up and replace it.")
        backup = root / "data" / "training" / "_voice_intake" / "backups" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup.mkdir(parents=True)
        shutil.copy2(root / "config.yaml", backup / "config.yaml")
        if dest.parent.exists():
            shutil.copytree(dest.parent, backup / mode)
        print(install_voice_sample(mode, sample["audio"], sample["text"], root)[1])
        print(f"Backup: {backup}")
    else:
        import soundfile as sf
        from pinokio_tts import PinokioTTSClient
        from voice_profiles import load_config

        if args.output.exists():
            raise ValueError("Output exists; choose another filename")
        client = PinokioTTSClient(load_config(root / "config.yaml").get("tts", {}))
        try:
            audio, rate, status = client.generate_voice_clone(sample["audio"], sample["text"], args.text, language=sample["language"])
            args.output.parent.mkdir(parents=True, exist_ok=True)
            sf.write(str(args.output), audio, rate, subtype="PCM_16")
            print(f"{status}\nSaved: {args.output.resolve()}")
        finally:
            client.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print(f"Voice intake: {exc}", file=sys.stderr)
        raise SystemExit(1)
