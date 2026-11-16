#!/usr/bin/env python3
"""tools/usage-dev.py: its argument parsing and the steps each command runs.

Nothing here runs a command's scripts: the steps are checked as data, and
`run` against stand-in programs in a scratch folder."""
import contextlib
import importlib.util
import io
import os
import re
import stat
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "usage_dev", os.path.join(ROOT, "tools", "usage-dev.py"))
dev = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dev)


def write_executable(path, text):
    """Write a stand-in program, make it executable, and run it once.

    macOS checks every new executable on its first run, in one daemon
    shared by the whole machine, and the check queues behind the other
    suites' writes; run here, it is paid before anything is counted."""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.chmod(path, stat.S_IRWXU)
    subprocess.run([path], stdin=subprocess.DEVNULL,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main(*argv):
    """(exit status, stdout, stderr) of usage-dev with these words."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            rc = dev.main(list(argv))
        except SystemExit as e:
            rc = e.code
    return rc, out.getvalue(), err.getvalue()


class Split(unittest.TestCase):
    def test_options_before_the_command_are_its_own(self):
        self.assertEqual(dev.split(["-n", "figures", "--cols"]),
                         (["-n"], "figures", ["--cols"]))

    def test_no_command(self):
        self.assertEqual(dev.split(["--list"]), (["--list"], None, []))
        self.assertEqual(dev.split([]), ([], None, []))

    def test_words_after_the_command_are_left_whole(self):
        self.assertEqual(dev.split(["test", "--repeat", "3", "-n"]),
                         ([], "test", ["--repeat", "3", "-n"]))


class Plan(unittest.TestCase):
    def test_words_go_to_the_script(self):
        self.assertEqual(
            dev.plan("figures", ["f.json", "--cols", "160"]),
            [(".", ["node", "mod/tools/draw-figures.ts",
                    "f.json", "--cols", "160"])])

    def test_a_leading_double_dash_is_dropped(self):
        self.assertEqual(dev.plan("figures", ["--", "--help"]),
                         [(".", ["node", "mod/tools/draw-figures.ts",
                                 "--help"])])

    def test_every_step_of_a_command_gets_the_words(self):
        self.assertEqual(dev.plan("fixtures", ["--help"]), [
            (".", ["node", "mod/tools/gen-config-cases.ts", "--help"]),
            (".", ["node", "mod/tools/gen-fold-saves.ts", "--help"]),
        ])

    def test_a_command_with_no_arguments_refuses_them(self):
        self.assertEqual(dev.plan("typecheck", []),
                         [("mod", ["npm", "run", "-s", "typecheck"])])
        with self.assertRaises(ValueError):
            dev.plan("typecheck", ["--watch"])

    def test_an_unknown_command(self):
        with self.assertRaises(KeyError):
            dev.plan("nope", [])

    def test_every_script_a_step_names_exists(self):
        for name, (_, _, steps) in dev.COMMANDS.items():
            for s in steps:
                for word in s.argv:
                    if word.endswith((".py", ".sh", ".ts")) and "*" not in word:
                        path = os.path.join(ROOT, s.cwd, word)
                        self.assertTrue(os.path.isfile(path),
                                        "%s: %s" % (name, path))

    def test_every_step_runs_in_a_folder_that_exists(self):
        for name, (_, _, steps) in dev.COMMANDS.items():
            for s in steps:
                self.assertTrue(os.path.isdir(os.path.join(ROOT, s.cwd)),
                                name)


class Main(unittest.TestCase):
    def test_help_lists_every_command(self):
        rc, out, _ = main("--help")
        self.assertEqual(rc, 0)
        for name in dev.COMMANDS:
            self.assertIn(name, out)

    def test_list_gives_each_command_its_help(self):
        rc, out, _ = main("--list")
        self.assertEqual(rc, 0)
        for name, (category, text, _) in dev.COMMANDS.items():
            self.assertIn("[%s]" % category, out)
            self.assertRegex(out, r"(?m)^  %s +%s$" % (
                re.escape(name), re.escape(text)))

    def test_command_help_is_usage_devs_own(self):
        rc, out, _ = main("figures", "--help")
        self.assertEqual(rc, 0)
        self.assertIn("usage-dev figures [ARGS...]", out)

    def test_dry_run_prints_the_steps(self):
        rc, out, _ = main("-n", "test", "--repeat", "3", "node")
        self.assertEqual(rc, 0)
        self.assertEqual(out, "(cd . && bash tests/all.sh --repeat 3 node)\n")

    def test_no_command_is_a_usage_error(self):
        rc, _, err = main()
        self.assertEqual(rc, 2)
        self.assertIn("COMMAND", err)

    def test_unknown_command_is_a_usage_error(self):
        self.assertEqual(main("nope")[0], 2)

    def test_arguments_to_a_command_without_them_are_a_usage_error(self):
        rc, _, err = main("typecheck", "foo")
        self.assertEqual(rc, 2)
        self.assertIn("typecheck takes no arguments", err)


class Run(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="usage-dev-")
        self.root = self.scratch.name
        self.log = os.path.join(self.root, "log")
        for name, rc in (("pass", 0), ("fail", 3)):
            write_executable(os.path.join(self.root, name),
                             '#!/bin/sh\necho "%s $*" >>"%s"\nexit %d\n'
                             % (name, self.log, rc))
        # write_executable runs each once; start the log after that.
        os.remove(self.log)

    def tearDown(self):
        self.scratch.cleanup()

    def steps(self, *names):
        return [(".", [os.path.join(self.root, n), "x"]) for n in names]

    def ran(self):
        with open(self.log) as f:
            return f.read().split()[::2]

    def test_every_step_runs_when_each_passes(self):
        self.assertEqual(dev.run(self.steps("pass", "pass"), root=self.root),
                         0)
        self.assertEqual(self.ran(), ["pass", "pass"])

    def test_it_stops_at_the_first_failure_with_its_status(self):
        self.assertEqual(
            dev.run(self.steps("pass", "fail", "pass"), root=self.root), 3)
        self.assertEqual(self.ran(), ["pass", "fail"])

    def test_a_program_not_on_path_is_127(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            rc = dev.run([(".", ["usage-dev-no-such-program"])],
                         root=self.root)
        self.assertEqual(rc, 127)
        self.assertIn("not on PATH", err.getvalue())


if __name__ == "__main__":
    unittest.main()
