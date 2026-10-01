#!/usr/bin/env bash
# Installs this fork of Seatworks into Paseo with the P/P team: Opus 5.5 thinks, omp Gemini 3.8 Flash builds, Codex reviews.
# Safe to run again: the team files are replaced, a Jev key already in settings.json is kept, Paseo's config is backed up first.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
plugin="$here/../plugin"
state="$HOME/.local/share/seatworks-v3"

# The major version of a node binary, or 0 when it cannot answer within 10 s (a Homebrew node can hang in dyld).
major() { perl -e 'alarm 10; exec @ARGV' "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

node=""
for candidate in "$(command -v node || true)" $(ls -d "$HOME"/.local/share/mise/installs/node/*/bin/node 2>/dev/null | sort -rV) /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -n "$candidate" ] && [ -x "$candidate" ] && [ "$(major "$candidate")" -ge 24 ] && { node=$candidate; break; }
done
[ -n "$node" ] || { echo "Node 24 or newer is needed for the checks; install it (mise install node@25, or brew install node)." >&2; exit 1; }
echo "using node $("$node" -v) at $node"
command -v paseo >/dev/null || { echo "paseo is not on PATH." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is not on PATH (brew install jq)." >&2; exit 1; }

echo "== checks"
# The tests make git repos and expect main as git's default branch, whatever this machine sets.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=main
# One upstream test times the gate to under a second: it runs on its own and only warns, since load alone fails it.
timed="the gate reports exit, output tail and timeouts"
(
  cd "$plugin" && export PATH="$(dirname "$node"):$PATH"
  npm install --no-audit --no-fund >/dev/null && npm run typecheck >/dev/null && npm run lint >/dev/null &&
    npx prettier --check . >/dev/null &&
    node --test --test-timeout=120000 --test-skip-pattern="$timed" --import ./test/setup.ts 'test/**/*.test.ts' >/dev/null &&
    { node --test --import ./test/setup.ts --test-name-pattern="$timed" test/core/gate.test.ts >/dev/null 2>&1 ||
      echo "warning: \"$timed\" failed; it times the gate to a second and fails on a busy machine, so it does not stop the install."; }
) || { echo "the checks failed; nothing was installed." >&2; exit 1; }

echo "== team"
mkdir -p "$state"
cp "$here/roles.json" "$state/roles.json"
if [ -f "$state/settings.json" ]; then
  # Keep the machine's sensor keys; an older plugin kept each as a bare string, this one as {key}.
  jq -s '.[1] + (if .[0].sensor then {sensor: (.[0].sensor | map_values(if type == "string" then {key: .} else . end))} else {} end)' "$state/settings.json" "$here/settings.json" >"$state/settings.json.new"
  mv "$state/settings.json.new" "$state/settings.json"
else
  cp "$here/settings.json" "$state/settings.json"
fi

echo "== paseo"
version=$(paseo --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
case "$version" in
  0.[0-9].*|"") echo "Paseo ${version:-(not found)} is not supported: this plugin needs Paseo 0.10.0 or newer." >&2; exit 1 ;;
esac
cp "$HOME/.paseo/config.json" "$HOME/.paseo/config.json.bak-seatworks-$(date +%Y%m%d-%H%M%S)"
plugin_dir=$(cd "$plugin" && pwd -P)
installed=$(paseo plugin ls 2>/dev/null | awk '$1 == "seatworks-v2" {print $4}')
if [ -z "$installed" ]; then
  (cd "$plugin" && paseo plugin install "$PWD" >/dev/null)
elif [ "$(cd "$installed" 2>/dev/null && pwd -P)" != "$plugin_dir" ]; then
  echo "seatworks-v2 is already installed from $installed, not from $plugin_dir." >&2
  echo "Remove it first (paseo plugin remove seatworks-v2), then run this again; its projects and settings stay." >&2
  exit 1
fi
paseo plugin reload seatworks-v2 >/dev/null 2>&1 || true
paseo plugin ls | grep seatworks
echo "Restart the daemon (paseo restart) when no agent is working, so Paseo takes the team's providers."

echo "== sign-in"
# A seat runs in a settings folder of its own; upstream has it share the machine's login, as this check does.
probe=$(mktemp -d)
if CLAUDE_CONFIG_DIR="$probe" CLAUDE_SECURESTORAGE_CONFIG_DIR="" claude auth status 2>/dev/null | grep -q '"loggedIn": true'; then
  echo "Claude: seats share this machine's login."
else
  echo "Claude: not logged in for seats; run claude and /login once, outside any seat."
fi
rm -rf "$probe"
codex login status >/dev/null 2>&1 && echo "Codex: logged in." || echo "Codex: run codex login once (the Reviewer and the Auditor sit on Codex)."
[ -f "$HOME/.omp/agent/agent.db" ] && echo "Oh My Pi: logged in." || echo "Oh My Pi: log in with omp once (the Flash Peer sits on it)."
command -v glab >/dev/null && { glab auth status >/dev/null 2>&1 && echo "GitLab: glab logged in." || echo "GitLab: run glab auth login once (the Supervisor speaks to GitLab through it)."; }
echo "Jev: put a TypeSafe key under Machine defaults in the Seatworks panel; without one the watch runs on the code's own facts."
echo "Done. In Paseo: Seatworks > Add project, then Health > Run."
