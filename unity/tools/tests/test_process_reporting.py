"""Expected failures are results; none of these tests crashes a subprocess."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import build
import cli
import editor_lease


class ProcessReportingTests(unittest.TestCase):
    def test_partial_filter_match_does_not_claim_all_requested_suites_ran(self):
        report = ET.fromstring('<test-run result="Passed" total="2" passed="2">'
            '<test-case fullname="ZKube.Tests.MoneyOverview.MoneyOverviewTests.Connect" />'
            '<test-case fullname="ZKube.Tests.StoreAppPageJourneyTests.Name" /></test-run>')
        self.assertEqual(build.missing_test_filters(report,
            'ZKube.Tests.MoneyOverviewTests;ZKube.Tests.StoreAppPageJourneyTests'),
            ['ZKube.Tests.MoneyOverviewTests'])
        self.assertEqual(build.missing_test_filters(report,
            'ZKube.Tests.MoneyOverview.MoneyOverviewTests;ZKube.Tests.StoreAppPageJourneyTests'), [])
        self.assertEqual(build.missing_test_filters(report, 'ZKube'), [])

    def test_pattern_selection_is_verified_against_case_names(self):
        report = ET.fromstring('<test-run><test-case fullname="ZKube.Tests.Board.Move(2)" /></test-run>')
        self.assertEqual(build.missing_test_filters(report, r'Board\.Move\(\d\)'), [])
        self.assertEqual(build.missing_test_filters(report, 'ZKubeXTests'), ['ZKubeXTests'])
        with self.assertRaisesRegex(RuntimeError, 'Empty Unity test filter'):
            build.missing_test_filters(report, 'ZKube;')
        with self.assertRaisesRegex(RuntimeError, 'Cannot verify Unity test filter'):
            build.missing_test_filters(report, '[')

    def setUp(self):
        scratch = TOOLS.parents[1] / "build/unity/tooling-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name)

    def test_expected_errors_exit_one_with_one_line_and_result_path(self):
        for error in (RuntimeError("lease held\nstack detail"), TimeoutError("command pending"),
                      subprocess.TimeoutExpired("editor", 45), FileNotFoundError("report missing"),
                      subprocess.CalledProcessError(1, ["compiler", "private argument"]),
                      SystemExit("test report missing")):
            with self.subTest(error=type(error).__name__):
                def fail():
                    raise error
                output = io.StringIO()
                with contextlib.redirect_stdout(output), self.assertRaises(SystemExit) as exit_result:
                    cli.run_main(fail, self.output / "results.txt")
                self.assertEqual(exit_result.exception.code, 1)
                self.assertEqual(len(output.getvalue().splitlines()), 1)
                self.assertIn(str(self.output / "results.txt"), output.getvalue())
                self.assertNotIn("private argument", output.getvalue())

    def test_script_bug_keeps_traceback(self):
        def bug():
            raise KeyError("unexpected implementation defect")
        with self.assertRaises(KeyError):
            cli.run_main(bug)

    def test_lease_covers_work_before_editor_and_can_be_inherited(self):
        path = self.output / "editor.lock"
        with patch.object(editor_lease, "LOCK_PATH", path), editor_lease.editor_lease() as fd:
            code = ("import sys; sys.path.insert(0, sys.argv[1]); "
                    "import editor_lease; from pathlib import Path; from cli import run_main; "
                    "editor_lease.LOCK_PATH=Path(sys.argv[2])\n"
                    "def main():\n"
                    "    with editor_lease.editor_lease(): pass\n"
                    "run_main(main)")
            command = [sys.executable, "-c", code, str(TOOLS), str(path)]
            rejected = subprocess.run(command, text=True, capture_output=True)
            self.assertEqual(rejected.returncode, 1)
            self.assertIn("Another Unity build/test operation is active", rejected.stdout)
            self.assertEqual(rejected.stderr, "")
            inherited = subprocess.run(command, pass_fds=(fd,), text=True, capture_output=True,
                                       env=dict(os.environ, ZKUBE_EDITOR_LEASE_FD=str(fd)))
            self.assertEqual(inherited.returncode, 0)
            self.assertNotIn("active", inherited.stdout)
            self.assertEqual(inherited.stderr, "")

    def test_build_rejects_held_lease_before_toolchain_or_dependency_work(self):
        path = self.output / "editor.lock"
        with patch.object(editor_lease, "LOCK_PATH", path), editor_lease.editor_lease(), \
             patch.object(build, "toolchain") as toolchain, patch.object(build, "run") as run, \
             patch.object(sys, "argv", ["build.py", "android"]):
            with self.assertRaisesRegex(RuntimeError, "Another Unity"):
                build.main()
            toolchain.assert_not_called()
            run.assert_not_called()

    def test_build_does_not_print_success_for_a_partially_matched_filter(self):
        def editor_result(*args):
            (self.output / 'editmode-tests.xml').write_text(
                '<test-run result="Passed" total="1" passed="1">'
                '<test-case fullname="ZKube.Present.Case" /></test-run>')
        output = io.StringIO()
        with patch.object(build, 'OUTPUT', self.output), \
             patch.object(editor_lease, 'LOCK_PATH', self.output / 'editor.lock'), \
             patch.object(build, 'toolchain', return_value=(Path('editor'), Path('android'))), \
             patch.object(build, 'run'), patch.object(build, 'native'), patch.object(build, 'prepare'), \
             patch.object(build, 'editor_run', side_effect=editor_result), \
             patch.object(sys, 'argv', ['build.py', 'test', '--test-filter', 'ZKube.Present;ZKube.Missing']), \
             contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, 'filters matched no cases: ZKube.Missing'):
                build.main()
        self.assertNotIn('passed', output.getvalue())

    def test_nonzero_exit_reads_log_and_requires_completion(self):
        log = self.output / "editor.log"
        def result(*args, **kwargs):
            log.write_text("method started\nerror: incomplete operation\n")
            return subprocess.CompletedProcess(args, -11)
        with patch.object(build.subprocess, "run", side_effect=result):
            with self.assertRaisesRegex(RuntimeError, "incomplete operation"):
                build.editor_run(["unused"], log, {}, lambda: False)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                build.editor_run(["unused"], log, {}, lambda: True)
            self.assertIn("completed successfully with noisy exit -11", output.getvalue())

    def test_exec_discards_stale_result_and_runs_only_batch_quit(self):
        log = self.output / "exec.log"
        receipt = log.with_suffix(".result.json")
        receipt.write_text(json.dumps({"method": "Example.Run", "status": "ok"}))
        def result(command, **kwargs):
            self.assertFalse(receipt.exists())
            for flag in ("-batchmode", "-nographics", "-quit"):
                self.assertIn(flag, command)
            log.write_text("error: compilation failed\n")
            return subprocess.CompletedProcess(command, 1)
        with patch.object(build.subprocess, "run", side_effect=result):
            with self.assertRaisesRegex(RuntimeError, "compilation failed"):
                build.execute("unused", "StandaloneLinux64", "Example.Run", {}, log)

    def test_sdk_failure_reports_cause_instead_of_unity_stack_frame(self):
        log = self.output / "sdk.log"
        def result(command, **kwargs):
            log.write_text("CommandInvokationFailure: Failed to update Android SDK package list.\n"
                           "UnityEngine.Debug:LogException(Exception)\n")
            return subprocess.CompletedProcess(command, 1)
        with patch.object(build.subprocess, "run", side_effect=result):
            with self.assertRaisesRegex(RuntimeError, "Failed to update Android SDK package list"):
                build.editor_run(["unused"], log, {}, lambda: False)

    def test_missing_test_or_method_report_cannot_satisfy_completion(self):
        path = self.output / "missing.json"
        self.assertFalse(build.completed_method(path, "Example.Run"))
        path.write_text(json.dumps({"method": "Other.Run", "status": "ok"}))
        self.assertFalse(build.completed_method(path, "Example.Run"))


if __name__ == "__main__":
    unittest.main()
