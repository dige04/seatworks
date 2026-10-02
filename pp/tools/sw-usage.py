#!/usr/bin/python3
"""Token use of a Seatworks project's seats, by role, by lane and by review, beside what the desk says came of it.

  sw-usage [project ...] [--json]      projects by slug or name part (francaisvn, video); none: every project with a ledger
  sw-usage [project ...] --save        also keep a snapshot, the mark a later wave is measured from
  sw-usage [project ...] --since       only what was spent since the last snapshot, beside the one before it

Tokens come from each seat's own session file (Claude, Codex, omp), found through Paseo's agent record; what came of
the work comes from the desk's ledger and events. Dollars are the ledger's, which only Claude seats report.
  fresh   input tokens the model read uncached      cache   input read from the prompt cache
  write   input written to the cache               out     output tokens, reasoning included
"""
import collections, datetime, glob, json, os, re, sys

HOME = os.path.expanduser("~")
STATE = f"{HOME}/.local/share/seatworks-v3/projects"
UUID = re.compile(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$")
FIELDS = ("fresh", "cache", "write", "out")


def zero():
    return dict.fromkeys(FIELDS, 0)


def add(total, part):
    for key in FIELDS:
        total[key] += part.get(key, 0)
    return total


def session_index():
    """Each session file by the id in its name, over the stores Claude, Codex and omp seats write."""
    patterns = [
        f"{HOME}/.claude/projects/**/*.jsonl",
        f"{HOME}/.claude/profiles/*/projects/**/*.jsonl",
        f"{HOME}/.codex/seats/*/sessions/**/*.jsonl",
        f"{HOME}/.codex/sessions/**/*.jsonl",
        f"{HOME}/.omp/seats/*/sessions/**/*.jsonl",
        f"{HOME}/.omp/agent/sessions/**/*.jsonl",
    ]
    index = {}
    for pattern in patterns:
        for path in glob.glob(pattern, recursive=True):
            match = UUID.search(path)
            # A profile's projects folder may be a link to the shared one: each file counts once, by where it really is.
            real = os.path.realpath(path)
            if match and real not in index.setdefault(match.group(1), []):
                index[match.group(1)].append(real)
    return index


def agent_sessions():
    """Paseo's agent id to the provider session it runs."""
    found = {}
    for path in glob.glob(f"{HOME}/.paseo/agents/**/*.json", recursive=True):
        try:
            record = json.load(open(path))
        except (OSError, ValueError):
            continue
        persistence = record.get("persistence") or {}
        session = persistence.get("sessionId") or persistence.get("nativeHandle")
        if record.get("id") and session:
            found[record["id"]] = session
    return found


def usage(path):
    """A session file's tokens, whichever harness wrote it."""
    total = zero()
    if "/.codex/" in path:
        last = None
        for line in open(path, errors="ignore"):
            if '"total_token_usage"' not in line:
                continue
            try:
                info = json.loads(line)["payload"]["info"]["total_token_usage"]
            except (ValueError, KeyError, TypeError):
                continue
            last = info
        if last:
            cached = last.get("cached_input_tokens", 0)
            total.update(fresh=last.get("input_tokens", 0) - cached, cache=cached, out=last.get("output_tokens", 0))
        return total
    if "/.omp/" in path:
        for line in open(path, errors="ignore"):
            if '"usage"' not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            u = (entry.get("message") or {}).get("usage") or entry.get("usage")
            if isinstance(u, dict) and "input" in u:
                add(total, {"fresh": u.get("input", 0), "cache": u.get("cacheRead", 0),
                            "write": u.get("cacheWrite", 0), "out": u.get("output", 0)})
        return total
    # Claude writes one line per content block, each with its message's usage: count each message once.
    messages = {}
    for line in open(path, errors="ignore"):
        if '"usage"' not in line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        message = entry.get("message") or {}
        u = message.get("usage")
        if entry.get("type") == "assistant" and isinstance(u, dict):
            messages[message.get("id") or entry.get("uuid")] = {
                "fresh": u.get("input_tokens", 0), "cache": u.get("cache_read_input_tokens", 0),
                "write": u.get("cache_creation_input_tokens", 0), "out": u.get("output_tokens", 0)}
    for part in messages.values():
        add(total, part)
    return total


def events(slug):
    out = []
    try:
        for line in open(f"{STATE}/{slug}/events.log"):
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    except OSError:
        pass
    return out


def analyse(slug, index, sessions):
    ledger = json.load(open(f"{STATE}/{slug}/ledger.json"))
    seats, missing = [], 0
    for agent in ledger["agents"].values():
        spent = agent.get("spent") or {}
        tokens = zero()
        paths = index.get(sessions.get(agent["id"], ""), [])
        for path in paths:
            add(tokens, usage(path))
        missing += not paths
        seats.append({"id": agent["id"], "role": agent.get("role", "?"), "lane": agent.get("lane"),
                      "task": agent.get("task"), "dollars": (spent.get("banked") or 0) + (spent.get("last") or 0),
                      "tokens": tokens, "found": bool(paths)})
    log = events(slug)
    done = collections.Counter(e.get("task") for e in log if e.get("kind") == "task.done")
    reviews = {e.get("task"): e.get("outcome") for e in log if e.get("kind") == "review.done"}
    incidents = collections.Counter()
    try:
        for item in json.load(open(f"{STATE}/{slug}/incidents.json"))["items"].values():
            incidents[item.get("label") or "unmarked"] += 1
    except (OSError, ValueError, KeyError):
        pass
    return {"slug": slug, "ledger": ledger, "seats": seats, "missing": missing, "done": done,
            "reviews": reviews, "incidents": incidents}


def weight(t):
    return sum(t.values())


def human(n):
    for unit, size in (("B", 1e9), ("M", 1e6), ("k", 1e3)):
        if n >= size:
            return f"{n / size:.1f}{unit}"
    return str(int(n))


def row(label, tokens, dollars, extra=""):
    return (f"  {label:<22}{human(weight(tokens)):>8}{human(tokens['fresh']):>9}{human(tokens['cache']):>9}"
            f"{human(tokens['write']):>8}{human(tokens['out']):>8}{dollars:>9.2f}  {extra}")


def report(a):
    ledger, seats = a["ledger"], a["seats"]
    total = add(zero(), {})
    for seat in seats:
        add(total, seat["tokens"])
    grand = weight(total) or 1
    print(f"\n=== {a['slug']}: {len(seats)} seats, {a['missing']} without a session file found")
    header = f"  {'':<22}{'total':>8}{'fresh':>9}{'cache':>9}{'write':>8}{'out':>8}{'$':>9}"

    print("\nBy role" + " " * 15 + "(share of all tokens, seats)")
    print(header)
    roles = collections.defaultdict(lambda: [zero(), 0.0, 0])
    for seat in seats:
        entry = roles[seat["role"]]
        add(entry[0], seat["tokens"])
        entry[1] += seat["dollars"]
        entry[2] += 1
    for role, (tokens, dollars, count) in sorted(roles.items(), key=lambda item: -weight(item[1][0])):
        print(row(role, tokens, dollars, f"{100 * weight(tokens) / grand:4.1f}%  {count} seats"))
    print(row("all", total, sum(s["dollars"] for s in seats)))

    print("\nBy lane" + " " * 15 + "(tasks merged/cut, reviews accepted/sent back, landed)")
    print(header)
    tasks = ledger["tasks"]
    for lane_id, lane in sorted(ledger["lanes"].items(), key=lambda item: int(item[0][1:]) if item[0][1:].isdigit() else 0):
        lane_seats = [s for s in seats if s["lane"] == lane_id]
        tokens = zero()
        for seat in lane_seats:
            add(tokens, seat["tokens"])
        mine = [t for t in tasks.values() if t.get("lane") == lane_id]
        code = [t for t in mine if t.get("kind") != "review"]
        merged = sum(t["status"] == "merged" for t in code)
        cut = sum(t["status"] == "cut" for t in code)
        outcomes = [a["reviews"].get(t["id"]) for t in mine if t.get("kind") == "review"]
        accepted = sum(o == "accept" for o in outcomes)
        per_task = f"  {human(weight(tokens) / merged)}/merged task" if merged else ""
        print(row(f"{lane_id} {lane.get('status', '')}", tokens, sum(s["dollars"] for s in lane_seats),
                  f"{merged}/{cut}  {accepted}/{len(outcomes) - accepted}  {'landed' if lane.get('landed') else '-'}"
                  f"{per_task}  {lane.get('title', '')[:40]}"))

    print("\nReviews" + " " * 15 + "(outcome; tokens a review spent for each send-back it made)")
    print(header)
    review_seats = [s for s in seats if s["role"] in ("reviewer", "second-reviewer") and s["task"]]
    for seat in sorted(review_seats, key=lambda s: -weight(s["tokens"])):
        outcome = a["reviews"].get(seat["task"], "-")
        print(row(f"{seat['task']} {seat['role'][:6]}", seat["tokens"], seat["dollars"], outcome))
    sent_back = sum(a["reviews"].get(s["task"]) not in (None, "accept") for s in review_seats)
    review_tokens = sum(weight(s["tokens"]) for s in review_seats)
    print(f"  {len(review_seats)} reviews, {sent_back} sent work back; "
          f"{human(review_tokens / sent_back) if sent_back else 'n/a'} review tokens per send-back")

    reworked = sum(n > 1 for n in a["done"].values())
    print(f"\nEfficiency: {human(grand)} tokens; {sum(t['status'] == 'merged' for t in tasks.values() if t.get('kind') != 'review')} "
          f"code tasks merged ({human(grand / max(1, sum(t['status'] == 'merged' for t in tasks.values() if t.get('kind') != 'review')))} each), "
          f"{reworked} handed back more than once; {sum(bool(l.get('landed')) for l in ledger['lanes'].values())} lanes landed. "
          f"Incidents: {dict(a['incidents'])}")


SNAPSHOTS = f"{HOME}/.local/share/seatworks-usage/snapshots"


def summary(a):
    """What a wave is measured by: tokens and dollars by role, code tasks merged, reviews and what they sent back."""
    roles = collections.defaultdict(lambda: {"tokens": 0, "dollars": 0.0, "seats": 0})
    for seat in a["seats"]:
        entry = roles[seat["role"]]
        entry["tokens"] += weight(seat["tokens"])
        entry["dollars"] += seat["dollars"]
        entry["seats"] += 1
    tasks = a["ledger"]["tasks"].values()
    reviews = [s for s in a["seats"] if s["role"] in ("reviewer", "second-reviewer") and s["task"]]
    return {
        "at": datetime.datetime.now().isoformat(timespec="seconds"),
        "roles": roles,
        "merged": sum(t["status"] == "merged" for t in tasks if t.get("kind") != "review"),
        "landed": sum(bool(l.get("landed")) for l in a["ledger"]["lanes"].values()),
        "review_tokens": sum(weight(s["tokens"]) for s in reviews),
        "sent_back": sum(a["reviews"].get(s["task"]) not in (None, "accept") for s in reviews),
        "incidents": dict(a["incidents"]),
    }


def minus(now, then):
    roles = {}
    for role in set(now["roles"]) | set(then["roles"]):
        n, t = now["roles"].get(role, {}), then["roles"].get(role, {})
        roles[role] = {key: n.get(key, 0) - t.get(key, 0) for key in ("tokens", "dollars", "seats")}
    out = {key: now[key] - then[key] for key in ("merged", "landed", "review_tokens", "sent_back")}
    out["incidents"] = {k: v - then["incidents"].get(k, 0) for k, v in now["incidents"].items()}
    return {**out, "roles": roles}


def show(label, w):
    total = sum(r["tokens"] for r in w["roles"].values()) or 1
    dollars = sum(r["dollars"] for r in w["roles"].values())
    per_task = human(total / w["merged"]) if w["merged"] else "n/a"
    per_back = human(w["review_tokens"] / w["sent_back"]) if w["sent_back"] else "n/a"
    print(f"  {label}: {human(total)} tokens, ${dollars:.2f}; {w['merged']} code tasks merged ({per_task} each), "
          f"{w['landed']} lanes landed; {per_back} review tokens per send-back; incidents {w['incidents']}")
    shares = sorted(w["roles"].items(), key=lambda item: -item[1]["tokens"])
    print("    " + ", ".join(f"{role} {100 * r['tokens'] / total:.0f}%" for role, r in shares if r["tokens"] > 0))


def snapshots(slug):
    return sorted(glob.glob(f"{SNAPSHOTS}/{slug}--*.json"))


def main(args):
    as_json = "--json" in args
    wanted = [arg for arg in args if not arg.startswith("--")]
    slugs = sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(f"{STATE}/*/ledger.json"))
    slugs = [s for s in slugs if not wanted or any(w in s for w in wanted)]
    index, sessions = session_index(), agent_sessions()
    results = [analyse(slug, index, sessions) for slug in slugs]
    if as_json:
        json.dump([{"slug": r["slug"], "seats": r["seats"]} for r in results], sys.stdout, indent=2)
        return
    if "--since" in args:
        for result in results:
            kept = snapshots(result["slug"])
            if not kept:
                print(f"{result['slug']}: no snapshot yet; take one with --save")
                continue
            last = json.load(open(kept[-1]))
            print(f"\n=== {result['slug']}: since the snapshot of {last['at']}")
            show("now", minus(summary(result), last))
            if len(kept) > 1:
                show("the wave before", minus(last, json.load(open(kept[-2]))))
    else:
        print(__doc__.split("\n\n")[-1].rstrip())
        for result in results:
            if result["seats"]:
                report(result)
    if "--save" in args:
        os.makedirs(SNAPSHOTS, exist_ok=True)
        for result in results:
            if result["seats"]:
                snap = summary(result)
                path = f"{SNAPSHOTS}/{result['slug']}--{snap['at'].replace(':', '')}.json"
                json.dump(snap, open(path, "w"), indent=2)
                print(f"snapshot kept: {path}")


if __name__ == "__main__":
    main(sys.argv[1:])
