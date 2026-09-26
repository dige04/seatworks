# Seatworks v3 · P/P edition

A fork of [sting9k/seatworks](https://github.com/sting9k/seatworks) `v3` (from `8216651`, 3.0.0-dev.30) tuned for one
Human with Claude Max 20x, Codex 5x, Antigravity (omp) 20x and a TypeSafe key. One Supervisor per project.

## Install

```bash
./pp/install.sh          # checks (Node >= 24), team files, Paseo plugin install, sign-in check
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
| Peer | omp · Gemini 3.8 Flash · high | bulk work, big pool, fast |
| Deep Peer | Claude Code · Opus 5.5 · medium | cross-cutting, terminal-heavy or risky work |
| Reviewer | Codex · GPT-6 Sol · high | lane 1 of the semantic pair, routine reviews |
| Second Reviewer | Claude Code · Opus 5.5 · xhigh | lane 2 of the semantic pair |
| Coverage Reviewer | Codex · GPT-6 Luna · max | lane 3: OCR delegation, every reviewable file accounted for |
| Watcher / Pager | Codex Luna · Claude Haiku 4.5 | watch cases, phone pages |

Jev (TypeSafe `jev-1.13.0`, asked directly at `api.typesafe.ai`) answers the watch's questions, in shadow.

## Rules (`pp/settings.json`)

- **Lead** picks `peer` or `peer-deep` per task. One review for routine work; a material question (contract, money,
  concurrency, security, a large lane) gets three lanes at once, none seeded with another's findings. Contradictions
  go back to both semantic reviewers; findings are checked for one converging cause before any rework. A lane is
  reported ready only after every review it started has come back.
- **Supervisor** never lands a lane whose review is running, and lands over a red gate only for tests another lane or a
  known failure owns, naming them.

## What this fork changes in code

| Commit | Change |
|---|---|
| `753268c` | Claude seats sign in from the keychain token; settings for Deep Peer and Second Reviewer |
| `8ad293d` | Coverage Reviewer role: `REVIEWER-OCR.md`, Codex settings and rules |
| `051a710` | Jev asked of TypeSafe directly, not through OpenRouter |
| `5ba17f8` | Land refused while a review runs; landing is a compare-and-swap (two lanes landing at once never drop one); `cut` never resets the Human's own checkout while it holds uncommitted work. Each with a fail-first test |

`npm run check`: 589/589.

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
