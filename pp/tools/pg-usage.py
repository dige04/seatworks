#!/usr/bin/python3
"""Token use of a piggery team, by role and by member, measured as sw-usage measures Seatworks: from each agent's own
session file. Beside it, what the team's mail says came of it: hand-backs, reworks, questions.

  pg-usage [team ...]     teams by name (default: every team piggery knows)
"""
import collections, glob, importlib.util, json, os, sqlite3, sys

HOME = os.path.expanduser("~")
DB = f"{HOME}/.piggery/piggery.db"
LOGS = f"{HOME}/.piggery/logs"
HERE = os.path.dirname(os.path.realpath(__file__))

spec = importlib.util.spec_from_file_location("sw_usage", os.path.join(HERE, "sw-usage.py"))
sw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sw)


def worker_sessions(participant):
    """The agent sessions a worker ran, from the session ids in its piggery logs."""
    found = set()
    for path in glob.glob(f"{LOGS}/{participant}/*.jsonl"):
        for line in open(path, errors="ignore"):
            if '"session_id"' in line or '"thread_id"' in line:
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                for key in ("session_id", "thread_id"):
                    if isinstance(entry.get(key), str):
                        found.add(entry[key])
    return found


def log_usage(participant):
    """An omp worker's tokens, read from the message_end events piggery logged for it: omp names no session id there."""
    tokens = sw.zero()
    for path in glob.glob(f"{LOGS}/{participant}/*.jsonl"):
        for line in open(path, errors="ignore"):
            if '"message_end"' not in line or '"usage"' not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            u = (entry.get("message") or {}).get("usage") or {}
            sw.add(tokens, {"fresh": u.get("input", 0), "cache": u.get("cacheRead", 0),
                            "write": u.get("cacheWrite", 0), "out": u.get("output", 0)})
    return tokens


def row(label, tokens, extra=""):
    return (f"  {label:<22}{sw.human(sw.weight(tokens)):>8}{sw.human(tokens['fresh']):>9}{sw.human(tokens['cache']):>9}"
            f"{sw.human(tokens['write']):>8}{sw.human(tokens['out']):>8}  {extra}")


def main(wanted):
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    teams = db.execute("select id, name from teams").fetchall()
    teams = [t for t in teams if not wanted or t[1] in wanted]
    index = sw.session_index()
    print("  fresh: uncached input   cache: input read from the prompt cache   write: input written to it   out: output")
    for team_id, name in teams:
        people = db.execute(
            "select id, name, role, harness, model, session_ref, transcript from participants where team_id = ?",
            (team_id,),
        ).fetchall()
        if not people:
            continue
        by_member = {}
        for pid, member, role, harness, model, session_ref, transcript in people:
            sessions = worker_sessions(pid) | ({session_ref} if session_ref else set())
            paths = {path for session in sessions for path in index.get(session, [])}
            if transcript and os.path.exists(transcript):
                paths.add(os.path.realpath(transcript))
            tokens = sw.zero()
            for path in paths:
                sw.add(tokens, sw.usage(path))
            if not paths and harness == "omp":
                tokens = log_usage(pid)
            key = (member, role)
            # A founder joins as a peer, then becomes the gate: one session, counted once, under its last role.
            if any(m == member for m, _ in by_member):
                by_member = {k: v for k, v in by_member.items() if k[0] != member}
            by_member[key] = (harness, model or "-", tokens, len(paths))
        kinds = collections.Counter(
            kind or "(none)"
            for (kind,) in db.execute("select kind from messages where team_id = ?", (team_id,)).fetchall()
        )
        total = sw.add(sw.zero(), {})
        for _, _, tokens, _ in by_member.values():
            sw.add(total, tokens)
        grand = sw.weight(total) or 1
        print(f"\n=== piggery team {name}: {len(by_member)} members")
        header = f"  {'':<22}{'total':>8}{'fresh':>9}{'cache':>9}{'write':>8}{'out':>8}"
        print("By role")
        print(header)
        roles = collections.defaultdict(lambda: [sw.zero(), 0])
        for (member, role), (_, _, tokens, _) in by_member.items():
            sw.add(roles[role][0], tokens)
            roles[role][1] += 1
        for role, (tokens, count) in sorted(roles.items(), key=lambda item: -sw.weight(item[1][0])):
            print(row(role, tokens, f"{100 * sw.weight(tokens) / grand:4.1f}%  {count} members"))
        print("By member")
        print(header)
        for (member, role), (harness, model, tokens, files) in sorted(by_member.items(), key=lambda item: -sw.weight(item[1][2])):
            print(row(f"{member} {role[:6]}", tokens, f"{harness}/{model}  {files} session files"))
        print(f"Mail: {dict(kinds)}")
        print(f"Total: {sw.human(grand)} tokens")


if __name__ == "__main__":
    main(sys.argv[1:])
