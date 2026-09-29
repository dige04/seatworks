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
(cd "$plugin" && PATH="$(dirname "$node"):$PATH" npm install --no-audit --no-fund >/dev/null && PATH="$(dirname "$node"):$PATH" npm run check >/dev/null) || { echo "npm run check failed; nothing was installed." >&2; exit 1; }

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
cp "$HOME/.paseo/config.json" "$HOME/.paseo/config.json.bak-seatworks-$(date +%Y%m%d-%H%M%S)"
(cd "$plugin" && paseo plugin install "$PWD" >/dev/null)
paseo plugin reload seatworks-v2 >/dev/null 2>&1 || true
paseo plugin ls | grep seatworks

echo "== sign-in"
if security find-generic-password -s "Seatworks Claude Code token" >/dev/null 2>&1; then
  echo "Claude seats sign in from the keychain token."
else
  echo "Claude seats need a token: run 'claude setup-token', then"
  echo "  security add-generic-password -U -s \"Seatworks Claude Code token\" -a \"\$USER\" -w"
  echo "and paste the token (sk-ant-oat...) at both prompts."
fi
echo "Done. In Paseo: Seatworks > Add project, then Health > Run."
