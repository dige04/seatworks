# Seatworks · P/P edition (on upstream main)

A thin fork of [sting9k/seatworks](https://github.com/sting9k/seatworks) `main` (3.0.0-dev.308) for one Human with
Claude Max, Codex, Antigravity (omp) and a TypeSafe key. Upstream now carries the SLP article's rules itself
(Architect, Auditor, a Supervisor across projects, measurements that hold the machine, no mail inside a running turn),
so this fork changes only the team and the Jev endpoint.

## Install, on this machine or another

Needs macOS, Paseo 0.10.0 or newer, Node 24 or newer (mise or Homebrew), `jq`, and `claude`, `codex`
and `omp` each logged in once.

```bash
# Outside ~/Documents: macOS privacy settings keep the Paseo daemon from reading there.
git clone -b main-pp git@github.com:dige04/seatworks.git ~/.local/share/seatworks-src
cd ~/.local/share/seatworks-src && ./pp/install.sh
paseo restart   # when no agent is working, so Paseo takes the team's providers
```

The installer runs the checks, puts the team in `~/.local/share/seatworks-v3`, keeps the machine's sensor keys,
installs the plugin (or reloads it when it is already installed from the same folder; from another folder it says to
remove that one first) and checks each agent's login. Then in Paseo: **Seatworks › Add project**, **Health › Run**,
put the TypeSafe key under **Machine defaults**, and start the Supervisor in that project.

Each machine keeps its own projects, ledgers and keys: nothing of that is in this repo.

## The team (`pp/roles.json`)

| Role | Agent · model · thinking |
|---|---|
| Supervisor | Claude Code · Opus 5.5 · high |
| Lead | Claude Code · Opus 5.5 · medium |
| Peer | Claude Code · Opus 5.5 · medium |
| Peer (Flash) | Oh My Pi · Gemini 3.8 Flash · high, like a Peer, for well-bounded work with a settled contract |
| Reviewer | Codex · GPT-6 Sol · high |
| Second reviewer | Claude Code · Opus 5.5 · xhigh, so the two lenses are two vendors |
| Architect | Claude Code · Opus 5.5 · high |
| Auditor | Codex · GPT-6 Sol · high |
| Watcher | follows the Peer |

`pp/settings.json` tells the Lead when to pick `peer-flash`, has Jev sift the watch with the Watcher seat judging only
what Jev flagged (Jev alone sent the Supervisor a flag it marked noise nine times in ten), has Jev ask review's checks,
and has the Supervisor speak Vietnamese to the Human.

## Tools beside Seatworks

`pp/tools/install-tools.sh` (add `--no-pg` to skip the Postgres) installs three tools, each safe to install again:

- `lanes-pg`: PostgreSQL 16 on 127.0.0.1:55500, run by launchd outside every seat's sandbox, so lanes have a database
  without touching the owner's. The superuser's password stays in the keychain; seats use `lanes_admin`
  (`lanes-pg env`), and `lanes-pg ls` and `lanes-pg drop <lane>` clear what lanes made. Needs `brew install postgresql@16`.
- `codex-budget`: every 15 minutes reads the Codex weekly quota from Codex's own session files; past 30 points in one
  day (`CODEX_DAILY_LIMIT`) it stops running Codex seats, tells each project's Supervisor to hold Codex work, and shows
  a notification. `codex-budget report` lists the sessions that spent the most.
- `sw-usage`: tokens by role, lane and review for a project, from each seat's session file beside the desk's ledger.
  `--save` keeps a snapshot; `--since` shows what a wave spent against the one before. `verify-exp.py` is the offline
  trial that measured a second model checking Jev's flags against the Supervisor's labels.
- `pg-usage`: the same measure for a piggery team, by role and member, from each worker's session, with the mail
  kinds its team exchanged.

## What this fork changes in code

| Change | Why |
|---|---|
| Jev asked of TypeSafe directly (`catalog/sensor/jev.json`) | the key is a TypeSafe key, not OpenRouter's |
| A lockfile install (`pnpm install --frozen-lockfile --store-dir …`) is no new dependency; a script on stdin or named by a variable is not run from outside the copy | each paged a Supervisor with nothing to act on |
| A failed look (`cat`, `ls`, `rg`, `sed -n` …) opens no `no-recovery` | finding nothing is an answer; none of these was useful |
| A code fact marked noise settles the same words from any seat of its lane, however piped or logged | every new Peer re-sent the lane's install command |
| A role may `uses` a command `refused.json` refuses: the Supervisor uses `gh`, run outside its sandbox (`sandbox.excludedCommands`) | it could not read CI, file an issue or merge, so the Human did it by hand |
| `attention.tell` lists the kinds that open an incident; the rest stay on the record | 97–99% of incidents were noise, and each woke the Supervisor at ~0.6M tokens |

Dropped from the earlier `v3-pp` fork because upstream covers them: the keychain token (shared login), the landing guard
for a running review, the SLP rules, and the per-role harness lists (upstream registers one provider per role of an
attached project). Dropped as not earning its cost: the OCR coverage reviewer and the Deep Peer (the Architect and the
Auditor take their place).

Checks: 367 tests; two fail on this machine for its environment only (a timing-sensitive gate test that passes on a
rerun, and a push test that expects git's default branch to be `main`).
