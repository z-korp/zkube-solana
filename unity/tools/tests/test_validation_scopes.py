import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


class ValidationScopes(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / "build" / "gate-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        script = (ROOT / "validate.sh").read_text()
        (self.root / "validate.sh").write_text(script)
        names = re.search(r"local expected=\$'([^']+)'", script)[1].split(r"\n")
        for name in names:
            source = ROOT / name
            if source.is_symlink():
                (self.root / name).symlink_to(os.readlink(source))
            else:
                (self.root / name).write_text("Validation fixture\n")
        (self.root / "programs").mkdir()
        (self.root / "programs" / "sample.rs").write_text("initial\n")
        (self.root / "sample.txt").write_text("initial\n")
        (self.root / ".gitignore").write_text("bin/\ncommands.log\n")
        self.git("init", "-q")
        for setting in ("user.name", "user.email"):
            value = subprocess.check_output(["git", "config", setting], cwd=ROOT, text=True).strip()
            self.git("config", setting, value)
        self.commit()
        binary = self.root / "bin"
        binary.mkdir()
        for command in ("cargo", "pnpm", "python3", "anchor"):
            stub = binary / command
            stub.write_text('#!/bin/sh\nprintf "%s %s\\n" "${0##*/}" "$*" >> "$VALIDATION_TRACE"\n')
            stub.chmod(0o755)
        self.env = dict(os.environ, NO_DNA="1", VALIDATION_TRACE=str(self.root / "commands.log"),
                        PATH=str(binary) + os.pathsep + os.environ["PATH"])

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True, text=True)

    def commit(self):
        self.git("add", ".")
        self.git("-c", "commit.gpgsign=false", "commit", "-qm", "test fixture")

    def run_gate(self, scope):
        trace = self.root / "commands.log"
        trace.unlink(missing_ok=True)
        subprocess.run(["bash", "validate.sh", scope], cwd=self.root, env=self.env,
                       check=True, capture_output=True, text=True)
        return trace.read_text()

    def test_change_gate_keeps_common_checks_and_editmode_without_packages(self):
        (self.root / "sample.txt").write_text("changed\n")
        calls = self.run_gate("change")
        for required in ("cargo test --workspace", "cargo clippy", "pnpm test", "pnpm run idl:check",
                         "python3 -m unittest", "build.py test --test-platform EditMode"):
            self.assertIn(required, calls)
        self.assertNotIn("anchor build", calls)
        self.assertNotIn("sbf_contract", calls)
        self.assertNotIn("build.py android", calls)
        self.assertEqual(calls.count("build.py fixtures"), 1)

    def test_change_gate_runs_sbf_for_staged_unstaged_and_untracked_program_changes(self):
        sample = self.root / "programs" / "sample.rs"
        sample.write_text("changed\n")
        for staged in (False, True):
            if staged:
                self.git("add", "programs")
            self.assertIn("--test sbf_contract", self.run_gate("change"))
        self.commit()
        (self.root / "programs" / "new.rs").write_text("new\n")
        self.assertIn("--test sbf_contract", self.run_gate("change"))

    def test_clean_change_gate_checks_the_last_commit(self):
        (self.root / "programs" / "sample.rs").write_text("changed\n")
        self.commit()
        self.assertIn("--test sbf_contract", self.run_gate("change"))

    def test_release_and_all_run_sbf_both_test_platforms_and_both_packages(self):
        (self.root / "sample.txt").write_text("changed\n")
        release = self.run_gate("release")
        self.assertEqual(release, self.run_gate("all"))
        for required in ("--test sbf_contract", "build.py test\n", "build.py android --identity money",
                         "build.py android --identity store"):
            self.assertIn(required, release)
        self.assertNotIn("--test-platform", release)


if __name__ == "__main__":
    unittest.main()
