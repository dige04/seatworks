# Seatworks · P/P edition (on upstream main)

A thin fork of [sting9k/seatworks](https://github.com/sting9k/seatworks) `main` (3.0.0-dev.308) for one Human with
Claude Max, Codex, Antigravity (omp) and a TypeSafe key. Upstream now carries the SLP article's rules itself
(Architect, Auditor, a Supervisor across projects, measurements that hold the machine, no mail inside a running turn),
so this fork changes only the team and the Jev endpoint.

## Install

```bash
./pp/install.sh   # checks, team files, Paseo plugin install; keeps the machine's sensor keys
```

Then in Paseo: **Seatworks › Add project**, **Health › Run**, and start the Supervisor in that project.

Claude seats share the machine's own Claude login: upstream starts them with `CLAUDE_SECURESTORAGE_CONFIG_DIR=""`,
so no token is needed.

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

`pp/settings.json` tells the Lead when to pick `peer-flash`, has Jev sift the watch and review's checks, and has the
Supervisor speak Vietnamese to the Human.

## What this fork changes in code

| Change | Why |
|---|---|
| Jev asked of TypeSafe directly (`catalog/sensor/jev.json`) | the key is a TypeSafe key, not OpenRouter's |

Dropped from the earlier `v3-pp` fork because upstream covers them: the keychain token (shared login), the landing guard
for a running review, the SLP rules, and the per-role harness lists (upstream registers one provider per role of an
attached project). Dropped as not earning its cost: the OCR coverage reviewer and the Deep Peer (the Architect and the
Auditor take their place).

Checks: 367 tests; two fail on this machine for its environment only (a timing-sensitive gate test that passes on a
rerun, and a push test that expects git's default branch to be `main`).
