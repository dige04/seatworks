#!/usr/bin/python3
"""One look at a piggery team at work: who is stuck, who reached the owner's Postgres, what was pushed and how CI took
it, how the machine and the Codex budget hold, and what it has spent. Lines that need a look start with "!".

  pg-watch <team> <repo> [<base commit the wave started from>]
"""
import json, os, re, subprocess, sys, time

HOME = os.path.expanduser("~")
OWNER_PG = ("5432", "55492")


def run(*cmd, cwd=None):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=120, cwd=cwd).stdout
    except Exception:
        return ""


def seconds(etime):
    days = 0
    if "-" in etime:
        d, etime = etime.split("-")
        days = int(d)
    parts = [int(x) for x in etime.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]


def main(team, repo, base):
    print(f"== {time.strftime('%d/%m %H:%M')} team {team}")
    ps = json.loads(run("piggery", "ps", "--json", "--no-start") or "{}")
    found = next((t for t in ps.get("teams", []) if t["name"] == team), None)
    now = time.time() * 1000
    started = (found or {}).get("created_at") or now
    roots = set()
    if not found:
        print("  (team not open)")
    for m in (found or {}).get("members", []):
        mins = (now - (m.get("state_since") or now)) / 60000
        stuck = (m["state"] == "working" and mins > 45) or m.get("unacked", 0) > 5
        title = ((m.get("assignment") or {}).get("title") or "")[:60]
        print(f"{'!' if stuck else ' '} {m['name']:<14} {m.get('role', ''):<10} {m['state']:<8} {mins:5.0f}m  "
              f"unacked={m.get('unacked', 0)}  {title}")
        if m.get("cwd"):
            roots.add(m["cwd"])

    # The owner's own Postgres: a client the team started, or one born during the wave, is worth a look.
    lsof = run("lsof", "-nP", "-iTCP:5432", "-iTCP:55492", "-sTCP:ESTABLISHED")
    worrying = []
    for line in lsof.splitlines()[1:]:
        cols = line.split()
        if cols[0].startswith("postgres"):
            continue
        pid = cols[1]
        age = seconds((run("ps", "-o", "etime=", "-p", pid).strip() or "0"))
        cwd = next((l.split(None, 8)[-1] for l in run("lsof", "-p", pid, "-a", "-d", "cwd").splitlines()[1:]), "?")
        born_in_wave = time.time() - age >= started / 1000
        in_team = any(cwd == root or cwd.startswith(root.rstrip("/") + "/") for root in roots)
        if born_in_wave or in_team:
            worrying.append(f"{cols[0]}({pid}) in {cwd}")
    print(("! team reached the owner's Postgres: " + "; ".join(sorted(set(worrying))))
          if worrying else "  owner's Postgres: nothing from the team")

    if os.path.isdir(os.path.join(repo, ".git")):
        run("git", "-C", repo, "fetch", "-q", "origin")
        if base:
            count = run("git", "-C", repo, "rev-list", "--count", f"{base}..origin/main").strip()
            latest = run("git", "-C", repo, "log", "-1", "--format=%h %cd %s", "--date=format:%d/%m %H:%M", "origin/main")
            print(f"  origin/main: {count} commits since {base}; latest {latest.strip()[:70]}")
        url = run("git", "-C", repo, "remote", "get-url", "origin").strip()
        match = re.search(r"[:/]([^/:]+/[^/]+?)(?:\.git)?$", url)
        slug = match.group(1) if match else ""
        for r in json.loads(run("gh", "run", "list", "-R", slug, "--branch", "main", "-L", "2", "--json",
                                "conclusion,status,name,createdAt") or "[]"):
            state = r.get("conclusion") or r.get("status")
            print(f"{'!' if state not in ('success', 'in_progress', 'queued') else ' '} CI {r['name']}: {state} "
                  f"({r['createdAt'][:16]})")

    load = float(run("sysctl", "-n", "vm.loadavg").split()[1])
    free = run("memory_pressure").split("free percentage:")[-1].strip()
    swap = run("sysctl", "vm.swapusage").split()[6]
    print(f"{'!' if load > 25 else ' '} machine: load {load}, free memory {free}, swap used {swap}")

    try:
        s = json.load(open(f"{HOME}/.local/share/codex-budget/state.json"))
        spent = (s.get("last") or 0) - (s.get("baseline") or 0)
        print(f"{'!' if s.get('tripped') else ' '} Codex: {s.get('last')}% of the week used, {spent:.0f} points today"
              + (" (budget tripped)" if s.get("tripped") else ""))
    except (OSError, ValueError):
        pass
    total = [l for l in run("pg-usage", team).splitlines() if l.startswith("Total:")]
    print("  " + (total[-1] if total else "pg-usage: nothing yet"))


if __name__ == "__main__":
    args = sys.argv[1:]
    main(args[0] if args else "francaisvn", args[1] if len(args) > 1 else f"{HOME}/Documents/my-projects/francaisvn",
         args[2] if len(args) > 2 else "")
