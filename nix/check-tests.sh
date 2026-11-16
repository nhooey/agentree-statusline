# The test suites, for `nix flake check`: tests/all.sh in a writable copy
# of the source, with HOME empty and every suite that can run in a build.
#
# Left out, each for what a build does not have:
#   typecheck-plugin  mod/.claude-plugin/types, written by Claude Code
#   plugin-test       the claude CLI
#   plugin-validate   the claude CLI
#
# The copy is made a repository of one commit, the flake's source as it
# is: the folds of mod/test list the fixtures with `git ls-files`, and
# `generated` fails on whatever `git status` shows.
# HOME is outside it, so nothing a suite writes there shows.
#
# Run by flake.nix with $src, the flake's source, and $modNodeModules set.
set -eu

cp -R "$src" source
chmod -R u+w source
export HOME="$PWD/home"
mkdir "$HOME"
cd source
export PYTHONDONTWRITEBYTECODE=1
git init -q
git add --all
git -c user.name=check -c user.email=check@localhost commit -qm source
# Linked after the commit, and ignored by .gitignore, as in a checkout.
ln -s "$modNodeModules" mod/node_modules

bash tests/all.sh --skip typecheck-plugin,plugin-test,plugin-validate
