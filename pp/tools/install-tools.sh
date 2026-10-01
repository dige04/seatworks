#!/bin/sh
# Installs the fork's tools beside Seatworks: lanes-pg (a Postgres for lanes), codex-budget (stops Codex seats past a
# daily share of the weekly quota) and sw-usage (tokens by role, lane and review). Safe to run again.
#   install-tools.sh            all three
#   install-tools.sh --no-pg    without the Postgres
set -eu
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$HOME/.local/bin" "$HOME/Library/LaunchAgents"

case " $* " in
  *" --no-pg "*) echo "lanes-pg: skipped." ;;
  *) sh "$here/setup-lanes-pg.sh" ;;
esac

ln -sf "$here/sw-usage.py" "$HOME/.local/bin/sw-usage"
ln -sf "$here/codex-budget.py" "$HOME/.local/bin/codex-budget"
echo "sw-usage: sw-usage <project> [--save | --since]."

LABEL=dev.seatworks.codex-budget
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/.local/share/codex-budget"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string><string>$here/codex-budget.py</string><string>check</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$HOME/.local/share/codex-budget/launchd.err</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "codex-budget: checks every 15 minutes; past ${CODEX_DAILY_LIMIT:-30}% of the weekly quota in a day it stops Codex seats and tells each Supervisor (codex-budget report)."
