#!/bin/sh
# Sets up the lanes Postgres: PostgreSQL 16 on 127.0.0.1:55500, apart from any Postgres of the owner's, run by launchd
# outside every seat's sandbox. The superuser's password stays in the keychain; seats reach it as lanes_admin, whose
# settings `lanes-pg env` prints. Safe to run again: a cluster that is already there is started, not made anew.
set -eu

PORT=55500
DIR="$HOME/.local/share/lanes-pg"
LABEL=dev.seatworks.lanes-pg
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
here=$(cd "$(dirname "$0")" && pwd)

PG=$(brew --prefix postgresql@16 2>/dev/null)/bin
[ -x "$PG/initdb" ] || { echo "PostgreSQL 16 is missing: brew install postgresql@16, then run this again." >&2; exit 1; }

mkdir -p "$DIR/bin" "$DIR/log"
chmod 700 "$DIR"

if [ ! -f "$DIR/data/PG_VERSION" ]; then
  super=$(openssl rand -hex 24)
  security add-generic-password -U -a postgres -s lanes-pg-superuser -w "$super"
  pwfile=$(mktemp)
  printf '%s\n' "$super" >"$pwfile"
  "$PG/initdb" -D "$DIR/data" -U postgres --auth=scram-sha-256 --pwfile="$pwfile" -E UTF8 --locale=C >/dev/null
  rm -f "$pwfile"
  cat >>"$DIR/data/postgresql.conf" <<EOF

# lanes-pg: the Postgres Seatworks lanes use, apart from the owner's own
listen_addresses = '127.0.0.1'
port = $PORT
unix_socket_directories = ''
max_connections = 200
logging_collector = on
log_directory = '$DIR/log'
EOF
  echo "Made a new cluster in $DIR/data."
fi

# launchd gives a job no locale, and Postgres will not start without one.
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$PG/postgres</string><string>-D</string><string>$DIR/data</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>LC_ALL</key><string>en_US.UTF-8</string>
    <key>LANG</key><string>en_US.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$DIR/log/launchd.err</string>
</dict></plist>
EOF
# A cluster another label already runs on this port is left to it.
if ! lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  for _ in 1 2 3 4 5 6 7 8 9 10; do lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && break; sleep 1; done
fi
lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || { echo "Postgres did not start; see $DIR/log." >&2; exit 1; }

if [ ! -f "$DIR/lanes.env" ]; then
  admin=$(openssl rand -hex 24)
  PGPASSWORD=$(security find-generic-password -a postgres -s lanes-pg-superuser -w) \
    "$PG/psql" -X -q -h 127.0.0.1 -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE lanes_admin LOGIN CREATEDB CREATEROLE PASSWORD '$admin'"
  umask 077
  cat >"$DIR/lanes.env" <<EOF
PGHOST=127.0.0.1
PGPORT=$PORT
PGUSER=lanes_admin
PGPASSWORD=$admin
LANES_PG_URL=postgres://lanes_admin:$admin@127.0.0.1:$PORT/postgres
EOF
fi

ln -sf "$here/lanes-pg" "$HOME/.local/bin/lanes-pg"
"$here/lanes-pg" ls >/dev/null && echo "lanes-pg: PostgreSQL 16 on 127.0.0.1:$PORT, ready (lanes-pg env | ls | drop <lane>)."
