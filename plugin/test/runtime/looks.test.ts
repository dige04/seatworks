import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { stateRoot } from "../../server/core/paths.ts";
import type { Judge, Question } from "../../server/core/ports.ts";
import { settle } from "./fake-timeline.ts";
import { type harness, laneWithPeer } from "./harness.ts";
import { book } from "./noticed.ts";

const KEY = "a-key-for-tests-only";
type Harness = ReturnType<typeof harness>;
type Asked = { state: Record<string, unknown>; questions: Record<string, Question> };

/**
 * A brain that answers each pattern by its id in `says`, and 0.05 to the rest, only where the words it reads hold `about`;
 * and what it was asked.
 */
function brain(says: Record<string, number>, why: Record<string, string> = {}, about = /./) {
  const asked: Asked[] = [];
  const judge: Judge = {
    async ask(state, questions) {
      asked.push({ state, questions });
      const hit = about.test(JSON.stringify(state));
      const answers = Object.fromEntries(
        Object.keys(questions).map((id) => [id, { likely: hit ? (says[id] ?? 0.05) : 0.05 }]),
      );
      return { answers, model: "vendor/model-1", why };
    },
  };
  return { asked, judge };
}

/** The machine settings read by `mode`'s brains, the sensor with its key. */
function brains(mode: "sensor" | "seat" | "both"): void {
  const file = join(stateRoot(), "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  writeFileSync(
    file,
    JSON.stringify({ ...settings, attention: { brain: mode, sensor: "jev" }, sensor: { jev: { key: KEY } } }),
  );
}

/** Every look the desk was handed since this was called, each awaited to its end. */
function looksOf(h: Harness, t: TestContext): () => Promise<void> {
  const spy = t.mock.method(h.runtime.desk, "look");
  return async () => {
    await settle();
    await Promise.all(spy.mock.calls.flatMap((call) => call.result ?? []));
  };
}

test("the watch's eye reads a seat's new words at its turn's end and while it runs, the sensor asks each its patterns, and a yes opens an incident told to whoever supervises", async (t) => {
  const sensed = brain({ "stand-in": 0.95 }, {}, /stub|placeholder/);
  const { h, sup, peer, timeline } = await laneWithPeer(undefined, { sensor: () => sensed.judge });
  brains("sensor");
  const looked = looksOf(h, t);
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "reasoning", text: "The parser is missing, so I'll build a stub for it." }, "t1");
  timeline.add({ type: "assistant_message", text: "Working on the cart.", messageId: "m1" }, "t1");
  timeline.beat("turn_completed", "t1");
  await looked();
  const thought = sensed.asked.find(
    (entry) => entry.state.text === "The parser is missing, so I'll build a stub for it.",
  )!;
  assert.ok(thought, "its thinking is read");
  assert.deepEqual([thought.state.goal, thought.state.acceptance], ["g", ["a"]], "beside what its work asks of it");
  assert.ok("stand-in" in thought.questions && !("big-decision" in thought.questions), "only what watches a Peer");
  const found = Object.values(book(h)).find((item) => item.kind === "stand-in")!;
  assert.deepEqual(
    [found.told !== undefined, found.quote, found.facts],
    [
      true,
      "The parser is missing, so I'll build a stub for it.",
      ["stand-in", "seen by Jev, 0.95 sure, in its thought"],
    ],
  );
  await h.idle(sup);
  assert.match(
    h.heard(sup).join("\n"),
    /INCIDENT I1 \(stand-in, attend\) on the Peer on L1-T1[^]*What was seen: The parser is missing, so I'll build a stub for it\./,
    "it reaches whoever supervises at once",
  );
  const asked = sensed.asked.length;

  timeline.beat("turn_started", "t2");
  timeline.add({ type: "reasoning", text: "A placeholder will do for the refund path." }, "t2");
  // Still being written, the last words wait for the next look; what came before them does not.
  timeline.add({ type: "assistant_message", text: "Checking the refu", messageId: "m2" }, "t2");
  await settle();
  await h.tick(Date.now() + 6 * 60_000);
  await looked();
  const running = sensed.asked.slice(asked).map((entry) => entry.state.text);
  assert.deepEqual(
    running,
    ["A placeholder will do for the refund path."],
    "a turn still running is looked at every few minutes",
  );
  assert.equal(
    book(h).I1!.later,
    "A placeholder will do for the refund path.",
    "seen again, it is kept beside what was told",
  );
  assert.doesNotMatch(h.heard(peer).join("\n"), /INCIDENT/);
  const asking = await h.call(sup, "supervisor", "message", {
    to: "L1-T1",
    text: 'You thought "The parser is missing, so I\'ll build a stub for it." What does the parser need?',
  });
  assert.equal(asking.ok, true, `the seat's own words are the Supervisor's to quote back: ${asking.text}`);

  assert.equal((await h.call(sup, "supervisor", "mark_incident", { id: "I1", verdict: "noise" })).ok, true);
  timeline.beat("turn_started", "t3");
  timeline.add({ type: "reasoning", text: "Another placeholder, for the tax table this time." }, "t3");
  timeline.beat("turn_completed", "t3");
  await looked();
  assert.deepEqual(
    Object.values(book(h)).map((item) => [item.id, item.count]),
    [["I1", 3]],
    "a pattern marked noise stays settled for its seat's task, in whatever words the next look finds it",
  );
});

test("with both brains the sensor sifts and the Watcher seat judges only what it flagged or left unsure, in the words its why quotes", async (t) => {
  const sensed = brain({ turning: 0.5, "stand-in": 0.05 });
  const seat = brain(
    { turning: 0.9 },
    { turning: 'It writes "scrap the queue and poll instead" with no reason given.' },
  );
  const { h, peer, timeline } = await laneWithPeer(undefined, { sensor: () => sensed.judge });
  brains("both");
  t.mock.method(h.runtime.desk.watcher, "judge", () => seat.judge);
  const looked = looksOf(h, t);
  timeline.beat("turn_started", "t1");
  const failing = { type: "shell", command: "node poll.js", exitCode: 1 };
  timeline.add({ type: "tool_call", callId: "c1", name: "Bash", status: "completed", detail: failing }, "t1");
  timeline.add({ type: "reasoning", text: "Scrap the queue and poll instead." }, "t1");
  timeline.beat("turn_completed", "t1");
  await looked();
  assert.equal(seat.asked.length, 1);
  assert.deepEqual(Object.keys(seat.asked[0]!.questions), ["turning"], "the unsure one, not what the sensor cleared");
  assert.deepEqual(seat.asked[0]!.state.items, ["[thought] Scrap the queue and poll instead."]);
  assert.deepEqual(seat.asked[0]!.state.facts, ["call-failed"], "beside what the code saw meanwhile");
  const found = Object.values(book(h)).find((item) => item.kind === "turning")!;
  assert.deepEqual(
    [found.seat, found.quote, found.facts[1]],
    [peer, 'It writes "scrap the queue and poll instead" with no reason given.', "judged by the Watcher seat"],
  );
});

test("a Lead's look reads the briefs it wrote since, against what watches a Lead, and a brain off reads nothing", async (t) => {
  const sensed = brain({ "pre-solves": 0.9 }, {}, /src\/cart\.ts/);
  const { h, lane } = await laneWithPeer(undefined, { sensor: () => sensed.judge });
  brains("sensor");
  const looked = looksOf(h, t);
  const lead = lane.lead!;
  const brief = { key: "b", title: "Totals", goal: "totals add up", acceptance: ["a"], outOfScope: ["the rest"] };
  await h.call(lead, "lead", "add_tasks", {
    tasks: [{ ...brief, hints: ["src/cart.ts"], context: "Edit src/cart.ts, add a sum()." }],
  });
  const stream = h.timelineOf(lead);
  stream.beat("turn_started", "l1");
  stream.add({ type: "assistant_message", text: "Laid out the totals task.", messageId: "l-m1" }, "l1");
  stream.beat("turn_completed", "l1");
  await looked();
  const read = sensed.asked.find((entry) => String(entry.state.text).startsWith("L1-T2: totals add up"))!;
  assert.ok(read, "the brief as its Peer reads it");
  assert.match(String(read.state.text), /Edit src\/cart\.ts, add a sum\(\)\.\nHints: src\/cart\.ts/);
  assert.ok("pre-solves" in read.questions && !("stand-in" in read.questions), "what watches a Lead, not a Peer");
  assert.ok(Object.values(book(h)).find((item) => item.kind === "pre-solves")?.told);

  const before = sensed.asked.length;
  h.machineSettings({ attention: { brain: "off" } });
  stream.beat("turn_started", "l2");
  stream.add({ type: "assistant_message", text: "Waiting on the hand-back.", messageId: "l-m2" }, "l2");
  stream.beat("turn_completed", "l2");
  await looked();
  assert.equal(sensed.asked.length, before, "with the brain off, nothing is asked");
});

test("after a restart the eye reads only what is new: neither a seat's past words nor a brief its Lead wrote before", async (t) => {
  const sensed = brain({});
  const { h, lane, timeline } = await laneWithPeer(undefined, { sensor: () => sensed.judge });
  brains("sensor");
  const lead = h.timelineOf(lane.lead!);
  const turn = (stream: typeof timeline, id: string, item: Record<string, unknown>) => {
    stream.beat("turn_started", id);
    stream.add({ type: "user_message", text: "Go on.", clientMessageId: `sw2-message-${id}` }, id);
    stream.add(item, id);
    stream.beat("turn_completed", id);
  };
  turn(timeline, "t1", { type: "reasoning", text: "First I read the cart module." });
  turn(lead, "l1", { type: "assistant_message", text: "Laid out the first task.", messageId: "l-m1" });
  await looksOf(h, t)();
  const read = () => sensed.asked.map((entry) => String(entry.state.text));
  assert.ok(read().includes("First I read the cart module."));

  h.restart();
  await h.tick();
  const looked = looksOf(h, t);
  const before = sensed.asked.length;
  turn(timeline, "t2", { type: "reasoning", text: "Now the totals." });
  turn(lead, "l2", { type: "assistant_message", text: "Waiting on the hand-back.", messageId: "l-m2" });
  await looked();
  assert.deepEqual(
    read().slice(before).sort(),
    ["Now the totals.", "Waiting on the hand-back."],
    "what the history replays was read before the restart, and the brief was laid out before it",
  );
});

test("what a look reads and an incident quotes is cut where the owner says, and a pattern the catalog calls a note is kept, never booked", async (t) => {
  const sensed = brain({ "stand-in": 0.95, wrapper: 0.95 });
  const { h, timeline } = await laneWithPeer(undefined, { sensor: () => sensed.judge });
  brains("sensor");
  h.projectSettings({ attention: { lookItemChars: 40, quoteChars: 20 } });
  const wrapper = h.runtime.kit.patterns.wrapper!;
  t.after(() => void delete wrapper.level);
  wrapper.level = "note";
  const looked = looksOf(h, t);
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "reasoning", text: "The parser is missing, so I will build a stub and wrap it later." }, "t1");
  timeline.beat("turn_completed", "t1");
  await looked();
  assert.deepEqual(
    sensed.asked.map((entry) => String(entry.state.text).split("\n")[0]),
    ["The parser is missing, so I will build a"],
    "the brains read each item cut to the owner's length",
  );
  assert.deepEqual(
    Object.values(book(h)).map((item) => [item.kind, item.quote]),
    [["stand-in", "The parser is missin\n[… 43 more characters]"]],
    "a quote too, and a note is no incident",
  );
});
