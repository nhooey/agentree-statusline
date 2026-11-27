// A command's words as a shell splits them, the short form a background
// task's row draws it in, and its folder chip (shell_words.ts); and the
// last line of a program's output a row draws (output_lines.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BG_PATH_SHORT, folderChip, shellWords, shortCommand,
} from "../src/shell_words.ts";
import type { Token } from "../src/shell_words.ts";
import { lastLine } from "../src/output_lines.ts";

const HOME = "/Users/u";

/** Each token of `s` as `w:<value>`, `op:<op>` or `r:<op>`; null where
 * it will not split. */
function shape(s: string): string[] | null {
  const t = shellWords(s);
  return t === null ? null : t.map((x: Token) => x.kind === "word"
    ? "w:" + x.value : x.kind === "op" ? "op:" + x.op : "r:" + x.op);
}

test("words split at blanks and operators, quotes taken off, escapes read",
() => {
  assert.deepEqual(shape("cd 'a b' && ls -l \"x y\"|wc"),
    ["w:cd", "w:a b", "op:&&", "w:ls", "w:-l", "w:x y", "op:|", "w:wc"]);
  assert.deepEqual(shape("echo a\\ b \\\"q\\\" $'x\\'y'"),
    ["w:echo", "w:a b", "w:\"q\"", "w:$'x\\'y'"]);
  assert.deepEqual(shape("make 2>&1 >out.log &>all <in; x>>y"),
    ["w:make", "r:2>&", "w:1", "r:>", "w:out.log", "r:&>", "w:all", "r:<",
      "w:in", "op:;", "w:x", "r:>>", "w:y"]);
  // Substitutions stay inside their word, with their own quotes.
  assert.deepEqual(shape("echo \"$(git rev-parse \"HEAD\")\" ${a:-b} `id`"),
    ["w:echo", "w:$(git rev-parse \"HEAD\")", "w:${a:-b}", "w:`id`"]);
  // A comment runs to the line's end; a line break is an operator.
  assert.deepEqual(shape("a # b c\nd"), ["w:a", "op:\n", "w:d"]);
  assert.deepEqual(shape("a \\\n b"), ["w:a", "w:b"]);
  // Whether a word holds an expansion or a glob.
  const plain = shellWords("ls 'x*' *.ts $HOME \"$x\"")!
    .map((x) => x.kind === "word" && x.plain);
  assert.deepEqual(plain, [true, true, false, false, false]);
});

test("a command that will not split is null", () => {
  for (const s of ["echo \"open", "echo 'open", "echo $(open", "echo `open",
    "x \\", "cat <<EOF", "diff <(a) <(b)", "tee >(gzip)", "echo ${open"]) {
    assert.equal(shellWords(s), null, s);
    assert.equal(shortCommand(s, HOME), null, s);
  }
});

test("the short form lifts leading cds off, into its folders", () => {
  assert.deepEqual(shortCommand("cd /a/b && make", HOME),
    { text: "make", dirs: ["/a/b"] });
  assert.deepEqual(shortCommand("cd x; cd 'y z' && make -j4", HOME),
    { text: "make -j4", dirs: ["x", "y z"] });
  // A line of its own, as BG_NEWLINE parts a command's lines.
  assert.deepEqual(shortCommand("cd plugin ⏎ npm test", HOME),
    { text: "npm test", dirs: ["plugin"] });
  // A cd alone, or after the first command, stays.
  assert.deepEqual(shortCommand("cd x", HOME), { text: "cd x", dirs: [] });
  assert.deepEqual(shortCommand("make && cd x && ls", HOME),
    { text: "make && cd x && ls", dirs: [] });
  // A cd in a pipeline or a subshell is no lift.
  assert.deepEqual(shortCommand("cd x | y", HOME),
    { text: "cd x | y", dirs: [] });
});

test("the short form leaves trailing output plumbing out", () => {
  const short = (s: string) => shortCommand(s, HOME)?.text;
  assert.equal(short("npm test 2>&1 | tail -20"), "npm test");
  assert.equal(short("make > build.log 2>&1"), "make");
  assert.equal(short("make &>/dev/null &"), "make");
  assert.equal(short("pytest -q | grep -v warn | head -5"), "pytest -q");
  assert.equal(short("go test ./... |& tail -3 > out"), "go test ./...");
  // Plumbing anywhere but at the end, and input, stay.
  assert.equal(short("make > a.log && echo done"), "make > a.log && echo done");
  assert.equal(short("sort < in.txt"), "sort < in.txt");
  // grep, tail and head as the command itself stay.
  assert.equal(short("grep -rn foo src"), "grep -rn foo src");
  assert.equal(short("tail -f log | cat"), "tail -f log | cat");
  // Nothing left but plumbing is no short form.
  assert.equal(shortCommand("> out", HOME), null);
});

test("the short form draws paths under the home folder from ~, and a " +
  "long one as …/ and its last component", () => {
  const short = (s: string, home = HOME) => shortCommand(s, home)?.text;
  assert.equal(short("ls /Users/u/x"), "ls ~/x");
  assert.equal(short("ls $HOME/x ${HOME}/y \"$HOME/z\""), "ls ~/x ~/y ~/z");
  assert.equal(short("ls /Users/u"), "ls ~");
  assert.equal(short("ls /Users/uv/x"), "ls /Users/uv/x");
  assert.equal(short("ls /Users/u/x", ""), "ls /Users/u/x");
  const long = "/private/tmp/claude-501/p/tasks/b3qupkikw.output";
  assert.ok(long.length > BG_PATH_SHORT);
  assert.equal(short("tail -f " + long + " | cat"),
    "tail -f …/b3qupkikw.output | cat");
  assert.equal(short("python3 ~/git/github/me/repo/tools/run.py"),
    "python3 …/run.py");
  assert.equal(short("cat '/Users/u/My Documents/some notes/a b.txt'"),
    "cat \"…/a b.txt\"");
  // A short path, a relative one and a URL stay as written.
  assert.equal(short("ls /usr/local/bin"), "ls /usr/local/bin");
  assert.equal(short("ls a/b/c/d/e/f/g/h/i/j/k/l/m"),
    "ls a/b/c/d/e/f/g/h/i/j/k/l/m");
  assert.equal(short("curl https://example.com/a/b/c/d/e/f"),
    "curl https://example.com/a/b/c/d/e/f");
});

test("the short form keeps every other word as written, its lines parted " +
  "by ⏎", () => {
  const short = (s: string) => shortCommand(s, HOME)?.text;
  assert.equal(short("echo 'a  b'   \"c\";ls"), "echo 'a  b' \"c\";ls");
  assert.equal(short("make ⏎ make install"), "make ⏎ make install");
  assert.equal(short("git log --oneline -3 # recent"),
    "git log --oneline -3");
});

test("the folder chip is where the cds lead, where that is not the " +
  "thread's folder", () => {
  const cwd = "/Users/u/git/p";
  assert.equal(folderChip(["/Users/u/git/p/docs"], cwd, HOME), "docs");
  assert.equal(folderChip(["docs"], cwd, HOME), "docs");
  assert.equal(folderChip(["docs", "../plugin"], cwd, HOME), "plugin");
  assert.equal(folderChip(["~/src"], cwd, HOME), "src");
  assert.equal(folderChip(["$HOME/src"], cwd, HOME), "src");
  assert.equal(folderChip(["/"], cwd, HOME), "/");
  // Equal to the thread's own: none.
  assert.equal(folderChip(["."], cwd, HOME), "");
  assert.equal(folderChip(["/Users/u/git/p/"], cwd, HOME), "");
  assert.equal(folderChip(["~/git/p"], cwd + "/", HOME), "");
  // Not known: none.
  assert.equal(folderChip([], cwd, HOME), "");
  assert.equal(folderChip(["/a"], "", HOME), "");
  assert.equal(folderChip(["$DIR"], cwd, HOME), "");
  assert.equal(folderChip(["-"], cwd, HOME), "");
  assert.equal(folderChip(["~/src"], cwd, ""), "");
});

test("an output's last line: passing trailing blank lines over, its " +
  "escapes gone, a progress line as its last carriage return left it", () => {
  assert.equal(lastLine("one\ntwo\n\n  \n"), "two");
  assert.equal(lastLine("\x1b[32m✓ passed\x1b[0m\n"), "✓ passed");
  assert.equal(lastLine("\x1b]0;title\x07done"), "done");
  assert.equal(lastLine("10%\r50%\r100%\n"), "100%");
  assert.equal(lastLine("10%\r50%\r\n"), "50%");
  assert.equal(lastLine("a\tb\x07\n"), "a       b");
  // Only escapes on the last line: the line before.
  assert.equal(lastLine("ok\n\x1b[2K\r\n"), "ok");
  // A read that started inside the file drops its first, partial line.
  assert.equal(lastLine("tail of a line\n", true), "");
  assert.equal(lastLine("part\nwhole\n", true), "whole");
  assert.equal(lastLine(""), "");
});
