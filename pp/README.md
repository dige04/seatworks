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
| Reviewer | Codex · GPT-6 Sol · high | default reviewer, when a review can change a decision |
| Second Reviewer | Claude Code · Opus 5.5 · xhigh | second lens for a hard decision or a risky landing |
| Coverage Reviewer | Codex · GPT-6 Luna · max | optional: OCR delegation, every reviewable file accounted for |
| Watcher / Pager | Codex Luna · Claude Haiku 4.5 | watch cases, phone pages |

Jev (TypeSafe `jev-1.13.0`, asked directly at `api.typesafe.ai`) answers the watch's questions, in shadow.

## Rules (`pp/settings.json`)

The rules follow Demon's [SLP article](https://vhlam.com/article/agent-orchestration-multi-agent-slp) (27/09/2026)
point by point. The article gives principles, not prompts, so each one became a rule for the seat that owns it.

| Article | Rule |
|---|---|
| A role is responsibility and authority, not a personality | Team rule; the upstream prompts already describe roles this way |
| Limiting who edits is not limiting who questions; one owner per scope until handoff | Team rule: read anything, raise it through the Lead, never overwrite another owner |
| Pre-solve: main fixes the hypothesis, the criteria and the answer format | Lead briefs in four parts: goal, required constraints with who set each, the design in use (open to question), unknowns and how to check them. Discovery gets no hypothesis or verdict format |
| The parachute: an earlier choice becomes a later constraint | Team rule: a choice an earlier task made is not a requirement; Supervisor watches for a choice hardening into a constraint nobody set |
| Strong models build workarounds around a wrong premise | Team and Peer rules: stop, `ask` with evidence, never add a layer to keep a premise shown wrong |
| The right to object, not a duty to | Team rule: object when evidence forces it and it would change a decision; agreement is a real answer |
| Lead does not defend the plan; keeping it needs a reason too | Lead sorts a challenge into: changes the decision, merely also reasonable, not worth the interruption. A redesign is questioned too |
| Evidence on the state that will be accepted; comparable measurements | Team rule, and the Lead closes the loop only on new evidence from the accepted code |
| The Human keeps control: which brief, whose constraint, open disagreements | Supervisor reports them; a redirect reaches the Lead's shared state and is confirmed from `status` |
| A Peer is whatever the Lead needs: implementer, architect, auditor, reviewer | Lead rule. No review lane is mandatory: a review only where its answer could change a decision |
| Better-SLP: judge by outcomes, drop what does not earn its cost | Supervisor rule for retrospectives: name mechanisms that rarely changed a result and propose dropping them, never add challenge because activity rose |
| Not for small changes or feel work (UI/UX, game feel) | Supervisor says so instead of opening a lane |

Kept from before: `peer` or `peer-deep` per task, findings settled as one judgment, one rework per shared cause, at
most two review rounds, and no landing while a review is out.

Not done: the article's Supervisor sees across projects (who holds the machine for a benchmark). Seatworks v3 has one
Supervisor per project.

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
