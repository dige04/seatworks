# Seatworks v3 · P/P edition

A fork of [sting9k/seatworks](https://github.com/sting9k/seatworks) `v3` (on `4c35563`, 3.0.0-dev.61) tuned for one
Human with Claude Max 20x, Codex 5x, Antigravity (omp) 20x and a TypeSafe key. One Supervisor per project.

## Install

```bash
./pp/install.sh          # checks (Node >= 24, found on PATH, mise or Homebrew), team files, Paseo plugin install, sign-in check
```

Then in Paseo: **Seatworks › Add project**, **Health › Run**, and start an agent with the provider
**Supervisor · Claude Code (sw2)** in that project. Put the TypeSafe key under **Machine defaults › Watcher**.

Claude seats run in a config directory of their own, which on macOS has no login: they sign in from a keychain token.

```bash
claude setup-token
security add-generic-password -U -s "Seatworks Claude Code token" -a "$USER" -w   # paste the sk-ant-oat… token
```

## The team (`pp/roles.json`)

| Role | Agent · model · effort | Why |
|---|---|---|
| Supervisor | Claude Code · Opus 5.5 · high | talks with you, decides the rest |
| Lead | Claude Code · Opus 5.5 · medium | owns a lane, judges hand-backs |
| Peer | Claude Code · Opus 5.5 · medium | most tasks |
| Deep Peer | Claude Code · Opus 5.5 · high | cross-cutting, terminal-heavy or risky work |
| Reviewer | Codex · GPT-6 Sol · high | lane 1 of the semantic pair, routine reviews |
| Second Reviewer | Claude Code · Opus 5.5 · xhigh | lane 2 of the semantic pair |
| Coverage Reviewer | Codex · GPT-6 Luna · max | lane 3: OCR delegation, every reviewable file accounted for |
| Watcher / Pager | Codex Luna · Claude Haiku 4.5 | watch cases, phone pages |

Jev (TypeSafe `jev-1.13.0`, asked directly at `api.typesafe.ai`) answers the watch's questions, in shadow.

## Rules (`pp/settings.json`)

- **Lead** picks `peer` or `peer-deep` per task. One review for routine work; a material question (contract, money,
  concurrency, security, a large lane) gets three lanes at once, none seeded with another's findings. The Lead settles
  findings as one judgment: only blocking ones (behavior, acceptance, security, data, a contract) are reworked, once, for
  their shared cause; the rest go in its report. It checks a rework itself, reviews again only for a changed contract or
  risky area, and stops at two review rounds. Reviewers mark each finding blocking or not.
- **Supervisor** never lands a lane whose review is running, and lands over a red gate only for tests another lane or a
  known failure owns, naming them.

## What this fork changes in code

| Change | Why |
|---|---|
| Claude seats sign in from the keychain token (`bin/seat-room`); settings for Deep Peer and Second Reviewer | a seat's own config directory has no login on macOS |
| Coverage Reviewer role: `REVIEWER-OCR.md`, Codex settings and rules | lane 3 of the review, OCR delegation |
| Jev asked of TypeSafe directly (`catalog/sensor/jev.json`) | the key is a TypeSafe key, not OpenRouter's |
| A lane is not landed while a review it started has not handed back, idle seat or not (`desk/lanes/landing.ts`, with a fail-first test; upstream's race test gets the review's hand-back before its last landing) | run 2 landed a lane before its review came back |

Upstream fixed on its own the two other bugs this fork used to patch: landings are now a compare-and-swap, one at a time,
and a task's cut never discards the Human's own work.

Checks (`tsc`, `eslint`, `prettier`, `node --test`): 226/226.

## Measured (3 end-to-end runs on a scratch repo)

| Run | Work | Hidden tests | Time | Notes |
|---|---|---|---|---|
| 1 | 4 lanes | 25/25 | 84 min | one Sol-medium review took 66 min |
| 2 | 4 lanes | 25/25 | 13 min | one review per lane; one lane landed before its review came back (now refused in code) |
| 3 | 4 lanes + refunds (money, concurrency) | 31/31 | 41 min | refunds got two three-lane rounds, reviews ran in parallel; lane 3 reported 100% coverage and a real unsafe-integer bug; the new guard refused one early landing; Jev answered 8/8 |

No run touched code outside what was asked; an unrelated failing test was asked about, never fixed unasked.

## Known limits

- omp seats have no sandbox: an omp Peer can read the TypeSafe key and, in principle, write to the desk's spool. Use
  trusted repositories; send work that reads untrusted input to `peer-deep`.
- The gate runs the Peers' code unsandboxed on the daemon, like any CI.
- `laneHome = isolate` is the safe standing order: lanes never work in your checkout.
- Upstream is pre-release and changes daily; this fork's code changes are kept small so it rebases.
