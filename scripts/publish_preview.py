"""Stage finished MP3 previews for public GitHub Pages. Never publishes reference audio.

Add one: python scripts/publish_preview.py add path/to/file.mp3 --title "Scene" --voice "Narrator" --room "Library"
Stage this production's five complete scenes: python scripts/publish_preview.py mansion PATH_TO_RUN_FOLDER
Then commit/push public/preview. Pages deploys automatically; the voting service
reads the public catalog from GitHub, so ordinary additions need no Worker deploy.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

REPO = Path(__file__).resolve().parents[1]
PUBLIC = REPO / 'public' / 'preview'
CATALOG = PUBLIC / 'catalog.json'


def add(source, title, voice, room, transcript='', label=None):
    source = Path(source).resolve()
    if not source.is_file() or source.suffix.lower() != '.mp3':
        raise ValueError('Provide a finished MP3 export, not a voice reference or directory.')
    if source.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('Keep each preview below 20 MB for static hosting.')
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', str(source)], text=True))
    if not any(item.get('codec_type') == 'audio' and item.get('codec_name') == 'mp3' for item in probe['streams']):
        raise ValueError('The file is not a decodable MP3.')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    slug = re.sub('[^a-z0-9_-]+', '-', (label or source.stem).lower()).strip('-_')[:80] or 'preview'
    clip_id = f'{slug}-{digest[:12]}'
    filename = clip_id + '.mp3'
    catalog = json.loads(CATALOG.read_text(encoding='utf-8')) if CATALOG.exists() else {'version': 1, 'title': 'All Hallows Eve at Meeker Mansion', 'clips': []}
    audio = PUBLIC / 'audio'
    audio.mkdir(parents=True, exist_ok=True)
    dest = audio / filename
    if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() != digest:
        raise ValueError('Destination hash mismatch; refusing to overwrite an existing preview.')
    if not dest.exists():
        shutil.copy2(source, dest)
    old = next((item for item in catalog['clips'] if item['id'] == clip_id), None)
    clip = {'id': clip_id, 'title': title, 'voice': voice, 'room': room, 'filename': filename,
            'duration_seconds': round(float(probe['format']['duration']), 2), 'sha256': digest,
            'added_at': old['added_at'] if old else datetime.now(timezone.utc).isoformat(), 'transcript': transcript.strip()}
    if old:
        catalog['clips'][catalog['clips'].index(old)] = clip
    else:
        catalog['clips'].append(clip)
    temp = CATALOG.with_suffix('.tmp')
    temp.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    temp.replace(CATALOG)
    print(f'Staged public preview: {title} ({clip["duration_seconds"]:.1f}s) -> {filename}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    one = commands.add_parser('add')
    one.add_argument('audio', type=Path)
    one.add_argument('--title', required=True)
    one.add_argument('--voice', default='Narrator')
    one.add_argument('--room', default='New preview')
    one.add_argument('--transcript', type=Path)
    batch = commands.add_parser('mansion')
    batch.add_argument('run', type=Path)
    args = parser.parse_args()
    if args.action == 'add':
        add(args.audio, args.title, args.voice, args.room, args.transcript.read_text(encoding='utf-8') if args.transcript else '')
    else:
        manifest = json.loads((args.run / 'render_manifest.json').read_text(encoding='utf-8'))
        scenes = [
            ('01_creepy_talking_head', 'Creepy Talking Head', 'Vincent Price-style voice', 'Basement hall'),
            ('04_yellow_parlor', 'Which One Is Dead?', 'Orson Welles-style voice', 'Yellow Parlor'),
            ('05_hair_wreath_full', 'The Hair Wreath', 'Rod Serling-style voice', 'Master Bedroom'),
            ('07_tea_parlor', 'Tea in the Parlor', 'Katharine Hepburn-style voice', "Eliza Jane’s Parlor"),
            ('08_funeral_narrator', 'A Final Goodbye', 'James Earl-style voice', 'Drawing Room'),
        ]
        for sid, title, voice, room in scenes:
            entry = manifest['scenes'][sid]
            spoken = '\n\n'.join(segment['text'] for segment in entry['segments'])
            add(entry['mp3'], title, voice, room, spoken, sid)
    print('\nOnly finished previews and their spoken scripts were staged. Commit/push public/preview to publish them.')


if __name__ == '__main__':
    main()
