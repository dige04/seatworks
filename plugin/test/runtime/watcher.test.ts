import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { stateRoot } from "../../server/core/paths.ts";
import { settle } from "./fake-timeline.ts";
import { type harness, heldRound, laneWithPeer, nobodySeated } from "./harness.ts";
import { hookAgent } from "./noticed.ts";

type Harness = ReturnType<typeof harness>;

/** The machine settings, with the watch read by the Watcher seat alone, or by no brain. */
function judgedBy(brain: "seat" | "off"): void {
  const file = join(stateRoot(), "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...settings, attention: { brain } }));
}

const kept = (state: string) => {
  const file = join(state, "assessments.log");
  return existsSync(file)
    ? readFileSync(file, "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
};

/** Resolves once `check` holds, as the desk's own awaits run their course; fails after two seconds. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let tries = 0; !check(); tries++) {
    assert.ok(tries < 200, `never: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await settle();
}

const watchersOf = (h: Harness) =>
  [...h.agents.values()].filter((agent) => agent.provider.startsWith("sw2-watcher-") && !agent.archivedAt);

/** The case id a letter or prompt asks about, the last one it names. */
const caseIn = (text: string) => [...text.matchAll(/CASE (C\w+) about/g)].at(-1)![1]!;

/** The questions the last case in `text` asks, by name. */
const questionsIn = (text: string) =>
  [...text.slice(text.lastIndexOf("Questions:")).matchAll(/^([a-z][\w-]*): /gm)].map((match) => match[1]!);

/** A lane with a Peer that thinks at each turn, the watch judged by the Watcher: each turn's end is a case. */
async function watched() {
  const { h, sup, lane, peer, timeline } = await laneWithPeer();
  judgedBy("seat");
  let turns = 0;
  const thinks = (thought: string, stream = timeline) => {
    const id = `t${++turns}`;
    stream.beat("turn_started", id);
    stream.add({ type: "user_message", text: "Go on.", clientMessageId: `sw2-message-${id}` }, id);
    stream.add({ type: "reasoning", text: thought }, id);
    stream.beat("turn_completed", id);
  };
  const judge = (by: string, text: string, says: string, why = "Nothing shows it.") =>
    h.call(by, "watcher", "judge", {
      case: caseIn(text),
      answers: questionsIn(text).map((question) => ({ question, says, why })),
    });
  return { h, sup, lane, peer, thinks, judge };
}

test("the Watcher's life: seated for a case, answering by the rules, kept while needed, let go after", async (t) => {
  const { h, sup, thinks, judge } = await watched();
  const role = h.runtime.kit.roles.find((entry) => entry.role === "watcher")!;
  const label = role.label;
  role.label = "Case reader";
  t.after(() => void (role.label = label));
  thinks("The parser is missing, so I'll build a stub for it.");
  await until(() => watchersOf(h).length === 1, "a Watcher is seated for the case");
  const [watcher] = watchersOf(h);
  assert.equal(watcher!.title, "Case reader", "titled as its role is named");
  assert.equal(watcher!.labels["paseo.parent-agent-id"], sup, "under the Supervisor, so Paseo never pushes its reply");
  assert.equal(watcher!.cwd, h.project.root);
  assert.match(
    watcher!.prompt!,
    /^CASE C\w+ about L1-T1: questions on the fields below\.\n\nseat:\nthe Peer on L1-T1 \(Clean build\)\n\ngoal:\ng\n[^]*items:\n- \[thought\] The parser is missing, so I'll build a stub for it\.\n\nQuestions:\nstruggling: [^\n]+\n {3}yes: [^\n]+\n {3}no: [^\n]+\n[^]*\n\nNext: judge C\w+: /,
  );
  const first = watcher!.prompt!;
  const asked = questionsIn(first);
  assert.ok(asked.includes("stand-in") && !asked.includes("pre-solves"), "the patterns that watch a Peer");
  const all = asked.map((question) => ({ question, says: "no", why: "Nothing shows it." }));
  const said = (answers: { question: string; says: string; why: string }[], id = caseIn(first), by = watcher!.id) =>
    h.call(by, "watcher", "judge", { case: id, answers });
  assert.match((await said(all, "C0")).text, /C0 is not waiting for an answer/);
  assert.match(
    (await said([{ ...all[0]!, question: "summary" }, ...all.slice(1)])).text,
    new RegExp(`^Nothing was recorded: answer ${asked[0]} once; summary is no question of C\\w+\\.$`),
  );
  assert.match((await said([...all, all[0]!])).text, new RegExp(`answer ${asked[0]} once`));
  assert.match(
    (await said([{ ...all[0]!, says: "probably" }, ...all.slice(1)])).text,
    new RegExp(`${asked[0]} takes yes, no, unsure`),
  );
  assert.match((await said([{ ...all[0]!, why: " " }, ...all.slice(1)])).text, new RegExp(`give ${asked[0]} a why`));
  assert.match((await said([...all, { ...all[0]!, question: "toString" }])).text, /toString is no question of C\w+/);
  const other = h.add("sw2-watcher-claude/claude-opus-5", h.root, "another Watcher");
  assert.match((await said(all, caseIn(first), other)).text, /was sent to another Watcher/);
  h.agents.get(other)!.archivedAt = new Date().toISOString();
  await settle();
  assert.deepEqual(kept(h.project.state), [], "nothing is kept of a refused answer");
  const answered = await judge(watcher!.id, first, "Yes", "It says it will build a stub for the parser.");
  assert.equal(answered.ok, true, answered.text);
  await settle();
  const [line] = kept(h.project.state);
  assert.deepEqual(
    [line!.by, line!.model, line!.answers, line!.why],
    [
      "watcher",
      watcher!.provider,
      Object.fromEntries(asked.map((question) => [question, { likely: 1 }])),
      Object.fromEntries(asked.map((question) => [question, "It says it will build a stub for the parser."])),
    ],
    "what it answers is kept beside the case",
  );
  assert.match((await said(all)).text, /is not waiting for an answer/, "a case is answered once");

  const mailed = () => h.heard(watcher!.id).join("\n");
  thinks("The refund path works too.");
  await h.idle(watcher!.id);
  await until(() => /The refund path works too/.test(mailed()), "the next case is mailed to it");
  assert.match(mailed(), /CASE C\w+ about L1-T1[^]*The refund path works too\./);
  assert.equal(watchersOf(h).length, 1, "the next case goes to the same Watcher");
  assert.equal((await judge(watcher!.id, mailed(), "unsure")).ok, true);
  await settle();
  assert.deepEqual(
    Object.values(kept(h.project.state).at(-1)!.answers as Record<string, unknown>)[0],
    { likely: 0.5 },
    "unsure is the middle",
  );

  h.projectSettings({ attention: { watcherAnswerMinutes: 5 } });
  thinks("Rounded, third time.");
  await until(() => /third time/.test(mailed()), "the third case is sent");
  await h.tick(Date.now() + 6 * 60_000);
  await settle();
  assert.equal(
    kept(h.project.state).at(-1)!.unasked,
    "no answer within 5 minutes",
    "a case left unanswered past the owner's time is given up",
  );
  assert.equal(watcher!.archivedAt, null, "while a lane is open and the watch is judged by it, the Watcher stays");

  thinks("Rounded, fourth time.");
  await until(() => /fourth time/.test(mailed()), "the fourth case is sent");
  judgedBy("off");
  await h.tick();
  assert.equal(watcher!.archivedAt, null, "judged by something else, it stays while its case waits");
  assert.equal((await judge(watcher!.id, mailed(), "no")).ok, true);
  await h.tick();
  assert.ok(watcher!.archivedAt, "and is let go once none does");

  judgedBy("seat");
  thinks("Rounded, fifth time.");
  await until(() => watchersOf(h).length === 1, "a Watcher is seated again");
  const [renewed] = watchersOf(h);
  assert.equal((await judge(renewed!.id, renewed!.prompt!, "no")).ok, true);
  renewed!.status = "idle";
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted after all" })).ok, true);
  await h.tick();
  assert.ok(renewed!.archivedAt, "with no lane open, no case can come, and the idle Watcher is let go");
});

test("cases at once seat one Watcher, and a case is given up only when nobody can take it, never by a round that could not yet see its Watcher", async (t) => {
  const { h, sup, lane, thinks } = await watched();
  h.agents.get(sup)!.archivedAt = new Date().toISOString();
  thinks("Rounded.");
  await until(() => kept(h.project.state).length === 1, "the case is kept");
  assert.deepEqual(watchersOf(h), [], "with no Supervisor seated no Watcher is seated");
  assert.match(String(kept(h.project.state)[0]!.unasked), /no Supervisor is seated/);

  h.agents.get(sup)!.archivedAt = null;
  // The Peer's turn and its Lead's end together: two cases, both for one Watcher.
  thinks("Half of it is done.");
  thinks("The Peer is halfway there.", h.timelineOf(lane.lead!));
  const cases = () => {
    const [watcher] = watchersOf(h);
    if (!watcher) return 0;
    return [watcher.prompt ?? "", ...h.heard(watcher.id)].join("\n").match(/^CASE /gm)?.length ?? 0;
  };
  await until(() => cases() === 2, "both cases reach one Watcher");
  assert.equal(watchersOf(h).length, 1);
  const read = await h.call(watchersOf(h)[0]!.id, "watcher", "record", { of: "L1-T1" });
  assert.equal(read.ok, true, read.text);
  nobodySeated(h);
  await h.tick();
  await settle();
  assert.deepEqual(
    kept(h.project.state)
      .slice(1)
      .map((line) => line.unasked),
    ["the Watcher it was sent to is gone", "the Watcher it was sent to is gone"],
    "with nobody seated, a case whose Watcher has gone is given up by the next round",
  );

  const slow = await watched();
  type Create = (options: { config: { provider: string } }) => Promise<unknown>;
  const workspaces = (slow.h.paseo as { workspaces: { ref: (id: string) => { agents: { create: Create } } } })
    .workspaces;
  const ref = workspaces.ref;
  let seat = () => {};
  const seated = new Promise<void>((resolve) => (seat = resolve));
  t.mock.method(workspaces, "ref", (id: string) => {
    const real = ref(id);
    const create: Create = async (options) => {
      if (options.config.provider.startsWith("sw2-watcher-")) await seated;
      return real.agents.create(options);
    };
    return { ...real, agents: { create } };
  });
  slow.thinks("Rounded.");
  await settle();
  await slow.h.tick(Date.now() + 16 * 60_000);
  seat();
  await until(() => watchersOf(slow.h).length === 1, "the Watcher is seated at last");
  const [late] = watchersOf(slow.h);
  assert.equal((await slow.judge(late!.id, late!.prompt!, "no")).ok, true, "its time runs from when it was sent");
  await settle();
  assert.equal(kept(slow.h.project.state).length, 1);
  assert.equal(kept(slow.h.project.state)[0]!.unasked, undefined);

  late!.archivedAt = new Date().toISOString();
  await slow.h.runtime.archived(hookAgent(slow.h, late!.id));
  const { round, release } = await heldRound(slow.h, t);
  slow.thinks("Rounded again.");
  await until(() => watchersOf(slow.h).length === 1, "a new Watcher is seated while the round is held");
  release();
  await round;
  const [next] = watchersOf(slow.h);
  const answered = await slow.judge(next!.id, next!.prompt!, "no");
  assert.equal(
    answered.ok,
    true,
    `a round whose listing was read before its Watcher was seated gave it up: ${answered.text}`,
  );
});
