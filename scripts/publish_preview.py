"""Stage deliberately selected MP3 previews for public GitHub Pages.

Add one: python scripts/publish_preview.py add path/to/file.mp3 --title "Scene" --voice "Narrator" --room "Library"
Stage this production's five complete scenes: python scripts/publish_preview.py mansion PATH_TO_RUN_FOLDER
Then commit/push public/preview. Pages deploys automatically; the voting service
reads the public catalog from GitHub, so ordinary additions need no Worker deploy.
"""
import argparse
from difflib import SequenceMatcher
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
    return clip


def publish_comparison(report_path, pair_id, title):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,59}', pair_id):
        raise ValueError('Use a short lowercase comparison ID.')
    report = json.loads(report_path.read_text(encoding='utf-8'))
    if report['holdout']['start_seconds'] <= report['reference']['end_seconds']:
        raise ValueError('Comparison passage overlaps the cloning reference.')
    processed = bool(report.get('processing_note'))
    original = add(report['original']['mp3'], f'{title} — Original recording', 'Original submitted performance · ' + ('noise-reduced, level-matched' if processed else 'loudness matched'), 'Voice comparison', report['holdout']['text'], pair_id + '-original')
    generated = add(report['ai']['mp3'], f'{title} — AI clone', 'AI-generated voice clone · ' + ('cleaned · ' if processed else '') + report['model'], 'Voice comparison', report['holdout']['text'], pair_id + '-ai')
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    selected = {original['id'], generated['id']}
    catalog['clips'] = [item for item in catalog['clips'] if item.get('comparison_id') != pair_id or item['id'] in selected]
    word_count = len(re.findall(r'[a-z0-9]+', report['holdout']['text'].lower()))
    for entry in catalog['clips']:
        if entry['id'] not in (original['id'], generated['id']):
            continue
        key = 'original' if entry['id'] == original['id'] else 'ai'
        entry['comparison_id'] = pair_id
        entry['recording_type'] = 'original' if key == 'original' else 'ai_clone'
        entry['measurements'] = {k: report[key][k] for k in ('duration_seconds', 'integrated_lufs', 'true_peak_dbtp')}
        entry['measurements']['words_per_minute'] = round(word_count * 60 / report[key]['duration_seconds'])
    expected = re.findall(r'[A-Za-z0-9]+', report['holdout']['text'])
    recognized = re.findall(r'[A-Za-z0-9]+', report['generation']['asr_text'])
    changes = []
    matcher = SequenceMatcher(None, [word.lower() for word in expected], [word.lower() for word in recognized])
    for operation, a, b, c, d in matcher.get_opcodes():
        if operation != 'equal':
            changes.append((' '.join(expected[a:b]) or '[extra words]') + ' → ' + (' '.join(recognized[c:d]) or '[not recognized]'))
    note = ('Automatic transcription differences: ' + '; '.join(changes) + '. Listen to these words; recognition can also be wrong.') if changes else 'The automatic transcript matched the passage wording. Listening review is still needed.'
    catalog.setdefault('comparisons', {})[pair_id] = {
        'title': title + ' — Original vs AI',
        'description': 'Hear the submitted actor recording beside an AI-generated version reading the same passage. The cloning reference comes from a separate part of the take.',
        'reference_duration_seconds': round(report['reference'].get('duration_seconds', report['reference']['end_seconds'] - report['reference']['start_seconds']), 2),
        'loudness_difference_lu': report['loudness_difference_lu'],
        'ai_word_error_rate': report['generation']['word_error_rate'],
        'qa_note': note,
        'method_note': report.get('processing_note', 'Only level matching was applied to these preview exports; timing and pitch were not adjusted.') + ' Duration, loudness and wording checks are measurements, not a voice-likeness score.',
    }
    if report.get('reference_cleanup'):
        cleanup = report['reference_cleanup']
        catalog['comparisons'][pair_id]['cleanup_note'] = (
            f'Reference cleanup: {cleanup["before"]["duration"] - cleanup["compacted_duration_seconds"]:.1f}s of quiet gaps removed; '
            f'quiet-window RMS reduced by {cleanup["before"]["quiet_decile_dbfs"] - cleanup["after_denoise"]["quiet_decile_dbfs"]:.1f} dB. '
            'This is a measured reference-noise indicator, not a promise of complete noise removal.'
        )
    CATALOG.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Share comparison: https://goldennftplatform-svg.github.io/VOICE/preview/?compare={pair_id}')


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
    pair = commands.add_parser('comparison', help='Publish only the selected original/clone excerpts and sanitized metrics')
    pair.add_argument('report', type=Path)
    pair.add_argument('--id', default='dar-matron')
    pair.add_argument('--title', default='DAR Matron')
    args = parser.parse_args()
    if args.action == 'add':
        add(args.audio, args.title, args.voice, args.room, args.transcript.read_text(encoding='utf-8') if args.transcript else '')
    elif args.action == 'comparison':
        publish_comparison(args.report, args.id, args.title)
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
