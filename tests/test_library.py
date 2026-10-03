import hashlib
import importlib.util
import json
import math
import shutil
import struct
import tempfile
import unittest
import wave
from pathlib import Path

spec = importlib.util.spec_from_file_location("voice_library", Path(__file__).parents[1] / "scripts" / "voice_library.py")
library = importlib.util.module_from_spec(spec)
spec.loader.exec_module(library)


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.receipt = "22222222-2222-4222-8222-222222222222"
        self.invite = "11111111-1111-4111-8111-111111111111"
        self.folder = self.root / "repo" / "submissions" / self.invite / self.receipt
        self.folder.mkdir(parents=True)
        self.audio = self.folder / "original.wav"
        with wave.open(str(self.audio), "wb") as output:
            output.setparams((2, 2, 16000, 0, "NONE", "not compressed"))
            output.writeframes(b"".join(struct.pack("<hh", *(int(6000 * math.sin(i * 0.1)),) * 2) for i in range(64000)))
        self.meta = {"schema_version": 1, "submission_id": self.receipt, "invite_id": self.invite, "voice_name": "Test actor", "transcript": "This is the complete transcript.", "audio_file": "original.wav", "bytes": self.audio.stat().st_size, "sha256": hashlib.sha256(self.audio.read_bytes()).hexdigest(), "consent": {"accepted": True, "version": "2026-10-02"}}
        self.manifest = self.folder / "metadata.json"
        self.save()

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        self.manifest.write_text(json.dumps(self.meta), encoding="utf-8")

    def test_tampering_and_traversal_rejected(self):
        self.meta["audio_file"] = "../../outside.wav"
        self.save()
        with self.assertRaises(ValueError):
            library.validate_metadata(self.manifest)
        self.meta["audio_file"] = "original.wav"
        self.meta["sha256"] = "0" * 64
        self.save()
        with self.assertRaisesRegex(ValueError, "checksum"):
            library.validate_metadata(self.manifest)

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg required")
    def test_prepare_converts_preserves_and_is_repeatable(self):
        samples, errors = library.prepare(self.root, self.root / "repo")
        self.assertEqual(errors, [])
        self.assertEqual(len(samples), 1)
        sample = samples[0]
        with wave.open(sample["audio"], "rb") as recording:
            self.assertEqual((recording.getframerate(), recording.getnchannels(), recording.getsampwidth()), (24000, 1, 2))
            self.assertAlmostEqual(recording.getnframes() / 24000, 4, places=2)
        self.assertEqual(sample["text"], self.meta["transcript"])
        self.assertTrue(sample["reference_ready"])
        self.assertEqual(library.find_sample(self.root, self.receipt)["submission_id"], self.receipt)
        again, errors = library.prepare(self.root, self.root / "repo")
        self.assertEqual(again, samples)
        self.assertEqual(self.audio.read_bytes(), (Path(sample["audio"]).parent / "original.wav").read_bytes())


if __name__ == "__main__":
    unittest.main()
