"""Parser checks replace transport before any Editor command-file write."""
import contextlib
import io
import json
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

    def test_finite_money_load_and_advance(self):
        self.assertEqual(self.invoke('load', '--surface', 'money', '--scenario', 'owner-overview')['scenario'], 'owner-overview')
        self.assertEqual(self.invoke('advance', '--surface', 'money')['action'], 'advance')

    def test_money_scenarios_match_generated_finite_graphs(self):
        scenarios = set()
        for name in ('money-overview', 'money-session', 'money-economy', 'money-claims', 'money-profile'):
            fixture = json.loads((ROOT / ('fixtures/unity-' + name + '-v1.json')).read_text())
            scenarios.update(row['id'] for row in fixture['scenarios'])
        modes = set()
        for path in sorted((ROOT / 'fixtures').glob('unity-money-*playable-v1.json')):
            playable = json.loads(path.read_text())
            mode = playable['inputs']['mode']
            self.assertIn(mode, ('campaign', 'daily'))
            self.assertNotIn(mode, modes, 'Duplicate playable fixture mode')
            modes.add(mode)
            self.assertEqual(playable['evidenceClass'], f'offline-synthetic-money-{mode}-trajectory')
            self.assertEqual(playable['terminal']['phase'], {'campaign': 'levelComplete', 'daily': 'finished'}[mode])
            scenarios.add(mode + '-playable')
        self.assertEqual(modes, {'campaign', 'daily'})
        self.assertEqual(set(evidence.MONEY_SCENARIOS), scenarios)
        for scenario in scenarios:
            self.assertEqual(self.invoke('load', '--surface', 'money', '--scenario', scenario)['scenario'], scenario)

    def test_outcome_is_only_a_finite_money_advance(self):
        self.assertEqual(self.invoke('advance', '--surface', 'money', '--outcome', 'success')['outcome'], 'success')
        for args in [('advance', '--outcome', 'success'), ('load', '--surface', 'money', '--scenario', 'owner-overview', '--outcome', 'success')]:
            with self.assertRaises(SystemExit) as error:
                self.invoke(*args)
            self.assertEqual(error.exception.code, 2)

    def test_money_input_routes_to_the_active_finite_host(self):
        value = self.invoke('input', '--surface', 'money')
        self.assertEqual((value['surface'], value['action']), ('money', 'input'))

    def test_rejects_missing_scenario_and_board_advance(self):
        for args in [('load', '--surface', 'money'), ('advance',)]:
            with self.assertRaises(SystemExit) as error:
                self.invoke(*args)
            self.assertEqual(error.exception.code, 2)

    def test_money_captures_require_artifact(self):
        with self.assertRaises(SystemExit):
            self.invoke('capture', '--surface', 'money')
        value = self.invoke('capture', '--surface', 'money', '--output', 'build/unity/example.png')
        self.assertEqual(value['output'], str((ROOT / 'build/unity/example.png').resolve()))
