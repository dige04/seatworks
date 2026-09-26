import assert from "node:assert/strict";
import { test } from "node:test";
import { KEPT, type Layer } from "../../shared/settings.ts";
import { countsInstead, leadState, seatText } from "../../client/format/flow.ts";
import { incidentState, judgeWords } from "../../client/format/watch.ts";
import { dropMcp, keptRoles, modelRow, setRole, withKey } from "../../client/model/layer.ts";
import type { FlowLane, WatchIncident, WatchJudge } from "../../shared/flow-views.ts";

const docs = {
  enabled: true,
  label: "Docs",
  roles: ["lead"],
  connect: { type: "http" as const, url: "https://x", headers: { Authorization: "Bearer SECRET" } },
};
const lead = { harness: "claude", model: "opus", thinking: "high", rules: "Never touch the generated client." };
const held: Layer = {
  rules: "Keep diffs small.",
  roles: { lead },
  attention: { longTurnMinutes: 30 },
  mcp: { docs },
  sensor: { other: { key: KEPT } },
};
const { mcp: _mcp, ...undocked } = held;
const EDITS: [string, (layer: Layer) => Layer, Layer][] = [
  [
    "changing a seat's agent forgets what was chosen for the old one and keeps what the owner wrote",
    (layer) => setRole(layer, "lead", { harness: "omp" }, true),
    { ...held, roles: { lead: { rules: lead.rules, harness: "omp" } } },
  ],
  [
    "changing its model keeps the rest of its choice",
    (layer) => setRole(layer, "lead", { model: "other" }),
    { ...held, roles: { lead: { ...lead, model: "other" } } },
  ],
  [
    "removing a server this layer added forgets it, token and all, rather than keeping it marked removed",
    (layer) => dropMcp(layer, "docs"),
    undocked,
  ],
  [
    "a key typed on the panel goes with the save beside the ones shown as KEPT",
    (layer) => withKey(layer, "jev", "a-new-key"),
    { ...held, sensor: { other: { key: KEPT }, jev: { key: "a-new-key" } } },
  ],
  [
    "forgetting one key leaves the others",
    (layer) => withKey({ ...layer, sensor: { ...layer.sensor, jev: { key: KEPT } } }, "jev", null),
    held,
  ],
  [
    "the last key forgotten leaves no sensor block",
    (layer) => withKey(layer, "other", null),
    { ...held, sensor: undefined },
  ],
];

test("a panel edit changes only what it names and keeps the rest of the layer", () => {
  for (const [what, edit, edited] of EDITS) assert.deepEqual(edit(held), edited, what);
});

test("re-pasting a server the owner gave to nobody leaves it given to nobody", () => {
  const reachable = ["supervisor", "lead", "peer", "reviewer"];
  assert.deepEqual(
    keptRoles([], reachable),
    [],
    "unticking the last role writes an empty list, a narrowing to nobody; a re-paste once gave the server to all four",
  );
  assert.deepEqual(keptRoles(undefined, reachable), reachable, "never narrowed is what does mean every reachable role");
  assert.deepEqual(keptRoles(["lead", "peer"], reachable), ["lead", "peer"]);
  assert.deepEqual(
    keptRoles(["lead", "designer"], reachable),
    ["lead"],
    "and a role that cannot reach it is dropped from the narrowing",
  );
});

test("the model row shows what is in force even when this agent does not list it, and offers a way back", () => {
  const opus = [{ id: "claude-opus-5", label: "Opus 5" }];
  const settled = modelRow("claude-opus-5", opus);
  assert.equal(settled.stray, false);
  assert.deepEqual(settled.options, [{ label: "Opus 5", value: "claude-opus-5" }]);
  const wrong = modelRow("glm-5-air", opus);
  assert.equal(
    wrong.value,
    "glm-5-air",
    "the seat's own model is what is shown, where the screen once printed Opus 5 and no control",
  );
  assert.equal(wrong.stray, true);
  assert.deepEqual(
    wrong.options,
    [
      { label: "Opus 5", value: "claude-opus-5" },
      { label: "glm-5-air", value: "glm-5-air" },
    ],
    "and it stays pickable so the owner can move off it",
  );
  assert.equal(modelRow("", opus).stray, false, "nothing chosen is not a stray choice");
});

test("a collapsed lane gives up its counts for a Lead that is waiting or gone", () => {
  const lane = (lead: { status: string; waiting: string[] } | null, open = false) => ({ taskCount: 3, open, lead });
  assert.equal(countsInstead(lane({ status: "running", waiting: [] })), true, "the ordinary case is the counts");
  assert.equal(
    countsInstead(lane({ status: "idle", waiting: [] }, true)),
    false,
    "an opened lane shows its Lead and its tasks",
  );
  assert.equal(countsInstead({ taskCount: 0, open: false, lead: { status: "idle", waiting: [] } }), false);
  assert.equal(
    countsInstead(lane({ status: "running", waiting: ["Write outside the working copy"] })),
    false,
    "lanes start collapsed, so the Lead's line is the only place a seat waiting on the owner shows",
  );
  assert.equal(
    countsInstead(lane({ status: "gone", waiting: [] })),
    false,
    "and a Lead that has gone is never news the counts may hide",
  );
  assert.equal(countsInstead(lane(null)), false);
});

test("a seat waiting on a permission names who answers it, and a landing held before the Human stepped out says so", () => {
  const asking = {
    id: "a1",
    label: "Peer",
    status: "running",
    minutes: 2,
    waiting: ["Write outside the working copy"],
  };
  assert.equal(seatText(asking, "you"), "waiting on you · Write outside the working copy");
  assert.equal(
    seatText(asking, "the Chief"),
    "waiting on the Chief · Write outside the working copy",
    "out of the loop, whoever supervises answers it, not the Human",
  );
  const held: FlowLane = {
    id: "L1",
    title: "Cart",
    status: "open",
    branch: "lane/l1-cart",
    copy: "S0",
    lead: asking,
    kept: [],
    tasks: [],
    taskCount: 1,
    running: 1,
    open: false,
    landApproval: { minutes: 3, approved: false, signals: ["It touches src/auth."], evidence: [] },
  };
  assert.equal(leadState(held, "you", true), "landing waits for your approval");
  assert.equal(leadState(held, "the Chief", false), "landing held from while you were in the loop");
});

const incident = (over: Partial<WatchIncident>): WatchIncident => ({
  id: "I1",
  title: "Built a stand-in for something that does not exist",
  level: "attend",
  name: "Peer · L1-T1 Pointer",
  minutes: 6,
  quote: "S9 said: patch.js is missing",
  told: false,
  lane: "L1",
  held: null,
  ...over,
});
const INCIDENTS: [Partial<WatchIncident>, string][] = [
  [{ told: true }, "told the Chief"],
  [{ held: "budget" }, "held · the lane's limit for today is reached"],
  [{ held: "probation" }, "held · most of this kind's last ten were marked noise"],
  [{ held: "nobody" }, "held · nobody is seated to tell"],
  [{ held: "shadow" }, "recorded · mail is off"],
  [{}, "recorded"],
];
const judge = { label: "Jev", minutes: null, detail: null };
const kept = "Its answers are kept in assessments.log; no seat is sent them.";
const JUDGES: [WatchJudge, ReturnType<typeof judgeWords>][] = [
  [
    { ...judge, label: "", state: "off" },
    {
      title: "No brain reads what the watch sees",
      hint: "Brains is off: set it on Team, on the Judge. The code's own facts go on.",
      tone: "muted",
    },
  ],
  [
    { ...judge, state: "nokey", detail: "OpenRouter key" },
    {
      title: "Jev is asked nothing: it has no key",
      hint: "Add its OpenRouter key on Team, under Machine defaults, on the Judge. The code's own facts go on.",
      tone: "muted",
    },
  ],
  [
    { ...judge, state: "waiting" },
    { title: "Jev answers the watch's questions", hint: `Nothing has been asked of it yet. ${kept}`, tone: "success" },
  ],
  [
    { ...judge, state: "answering", minutes: 3 },
    { title: "Jev answers the watch's questions", hint: kept, tone: "success" },
  ],
  [
    { ...judge, state: "failing", minutes: 4, detail: "503: busy" },
    {
      title: "Jev is not answering",
      hint: "503: busy. The code's own facts go on; nothing waits for an answer.",
      tone: "warning",
    },
  ],
];

test("the watch card says in words where an incident has got to and who answers the watch's questions, and how that stands, naming roles as the kit labels them", () => {
  for (const [over, words] of INCIDENTS) assert.equal(incidentState(incident(over), "Chief"), words);
  for (const [state, words] of JUDGES) assert.deepEqual(judgeWords(state, "Judge"), words, state.state);
});
