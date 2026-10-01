#!/usr/bin/python3
"""Codex weekly quota guard: past LIMIT points used in one local day, stop Codex seats and tell the Supervisor.

  codex-budget.py check    run by launchd every 15 minutes
  codex-budget.py report   today's usage and the sessions that spent it
"""
import datetime, glob, json, os, subprocess, sys

HOME = os.path.expanduser("~")
DIR = os.path.join(HOME, ".local/share/codex-budget")
STATE = os.path.join(DIR, "state.json")
LOG = os.path.join(DIR, "codex-budget.log")
LIMIT = float(os.environ.get("CODEX_DAILY_LIMIT", "30"))
STATE_ROOT = os.path.join(HOME, ".local/share/seatworks-v3/projects")
PASEO = os.path.join(HOME, ".local/bin/paseo")
ENV = {**os.environ, "PATH": f"{HOME}/.local/bin:/opt/homebrew/bin:/usr/bin:/bin"}
for key in ("PASEO_AGENT_ID", "PASEO_AGENT_CWD"):
    ENV.pop(key, None)


def log(text):
    with open(LOG, "a") as out:
        out.write(f"{datetime.datetime.now().isoformat(timespec='seconds')} {text}\n")


def sessions(hours):
    cutoff = datetime.datetime.now().timestamp() - hours * 3600
    files = glob.glob(f"{HOME}/.codex/sessions/**/*.jsonl", recursive=True)
    files += glob.glob(f"{HOME}/.codex/seats/*/sessions/**/*.jsonl", recursive=True)
    return [f for f in files if os.path.getmtime(f) >= cutoff]


def records(files):
    """Each file's weekly quota readings and its last total token count."""
    for f in files:
        usage, total = [], None
        for line in open(f, errors="ignore"):
            if '"token_count"' not in line and '"rate_limits"' not in line:
                continue
            try:
                payload = json.loads(line).get("payload", {})
                at = json.loads(line).get("timestamp", "")
            except ValueError:
                continue
            limits = payload.get("rate_limits") or {}
            for window in (limits.get("primary"), limits.get("secondary")):
                if window and window.get("window_minutes") == 10080:
                    usage.append((at, window["used_percent"], window.get("resets_at")))
            info = payload.get("info") or {}
            if info.get("total_token_usage"):
                total = info["total_token_usage"]
        yield f, usage, total


def weekly():
    readings = [u for _, usage, _ in records(sessions(24)) for u in usage]
    return max(readings) if readings else None


def load():
    try:
        return json.load(open(STATE))
    except (OSError, ValueError):
        return {}


def notify(text):
    subprocess.run(["osascript", "-e", f"display notification {json.dumps(text)} with title \"Codex budget\""], env=ENV)


def supervisors():
    """Every project's Supervisor the desk still counts on, from each ledger."""
    found = []
    for path in glob.glob(f"{STATE_ROOT}/*/ledger.json"):
        try:
            agents = json.load(open(path)).get("agents", {}).values()
        except (OSError, ValueError):
            continue
        found += [a["id"] for a in agents if a.get("role") == "supervisor" and not a.get("gone")]
    return found


def trip(used, spent):
    notify(f"Codex used {spent:.0f}% of its weekly quota today (now {used:.0f}%). Codex seats stopped.")
    stopped = []
    try:
        agents = json.loads(subprocess.run([PASEO, "ls", "--json"], env=ENV, capture_output=True, text=True, timeout=60).stdout or "[]")
    except Exception as error:
        agents = []
        log(f"paseo ls failed: {error}")
    for agent in agents:
        provider = str(agent.get("provider", ""))
        if "codex" in provider and agent.get("status") == "running":
            subprocess.run([PASEO, "stop", agent["id"]], env=ENV, capture_output=True, timeout=60)
            stopped.append(f"{agent['id'][:8]} {provider}")
    message = (
        f"CODEX BUDGET: Codex has used {spent:.0f} points of its weekly quota today (limit {LIMIT:.0f}), now at {used:.0f}%. "
        f"The Human wants to stop and see why it costs so much. Codex seats that were running have been stopped: "
        f"{', '.join(stopped) or 'none'}. Open no review, lane or seat on Codex until the Human allows it; a lane waiting on a "
        "review stays as it is. Tell the Human, in their language, which lanes and reviews ran on Codex today, how long each "
        "took, and why you think it cost so much. Tokens by session: codex-budget report."
    )
    for supervisor in supervisors():
        subprocess.run([PASEO, "send", "--no-wait", supervisor, message], env=ENV, capture_output=True, timeout=60)
    log(f"TRIPPED used={used} spent={spent} stopped={stopped}")


def check():
    reading = weekly()
    if reading is None:
        return
    at, used, resets = reading[0], reading[1], reading[2]
    today = datetime.date.today().isoformat()
    state = load()
    if state.get("day") != today or state.get("resets_at") != resets or used < state.get("baseline", 0):
        state = {"day": today, "resets_at": resets, "baseline": used, "tripped": False}
    spent = used - state["baseline"]
    state.update(last=used, last_at=at)
    if spent >= LIMIT and not state["tripped"]:
        trip(used, spent)
        state["tripped"] = True
    json.dump(state, open(STATE, "w"), indent=2)


def report():
    state = load()
    print(f"weekly used now {state.get('last')}%, at day start {state.get('baseline')}%, "
          f"spent today {(state.get('last') or 0) - (state.get('baseline') or 0):.1f} points (limit {LIMIT:.0f})")
    rows = []
    for f, usage, total in records(sessions(24)):
        if not total:
            continue
        seat = f.split("/.codex/seats/")[1].split("/")[0] if "/.codex/seats/" in f else "own session"
        rows.append((total.get("total_tokens", 0), total.get("input_tokens", 0), total.get("output_tokens", 0),
                     seat, os.path.basename(f)[8:27]))
    for total, inp, out, seat, started in sorted(rows, reverse=True)[:15]:
        print(f"{total:>12,} tokens (in {inp:,}, out {out:,})  {seat}  started {started}")


if __name__ == "__main__":
    {"check": check, "report": report}.get(sys.argv[1] if len(sys.argv) > 1 else "report", report)()
