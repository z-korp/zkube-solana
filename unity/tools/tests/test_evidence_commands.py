"""Parser checks replace transport before any Editor command-file write."""
import contextlib
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'unity/tools'))
import evidence


class EvidenceCommandTests(unittest.TestCase):
    def invoke(self, *args):
        with patch.object(sys, 'argv', ['evidence.py', *args]), patch.object(evidence, 'command', return_value={'status': 'ok'}) as send, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            evidence.main()
            return send.call_args.kwargs

    def test_board_default_preserved(self):
        self.assertEqual(self.invoke('readiness')['surface'], 'board')

    def test_rejects_retired_money_surface_and_missing_board_fixture(self):
        for args in [('load', '--surface', 'money', '--scenario', 'owner-overview'), ('advance',), ('load',)]:
            with self.assertRaises(SystemExit) as error:
                self.invoke(*args)
            self.assertEqual(error.exception.code, 2)

    def test_board_capture_requires_artifact(self):
        with self.assertRaises(SystemExit):
            self.invoke('capture')
        value = self.invoke('capture', '--output', 'build/unity/example.png')
        self.assertEqual(value['output'], str((ROOT / 'build/unity/example.png').resolve()))
