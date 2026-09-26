import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

const parser = {
  key: "s",
  title: "Parser",
  goal: "g",
  acceptance: ["a"],
  holds: ["b.txt"],
  outOfScope: ["the rest"],
  parallel: true,
};

test("a Lead widening what a task beside others holds, or turning a task to another goal, is W's to tell whoever supervises; less than that is not", async () => {
  const { h, sup, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [parser] });
  const amend = (args: Record<string, unknown>) =>
    h.call(lane.lead!, "lead", "amend_task", { task: "L1-T2", why: "the parser lives there", ...args });
  for (const change of [
    { acceptance: ["a", "b"] },
    { holds: ["b.txt", "c.txt"] },
    { holds: ["c.txt"] },
    { hints: ["d.txt"], context: "d.txt reads the header" },
    { goal: "parse the header instead" },
  ]) {
    const amended = await amend(change);
    assert.equal(amended.ok, true, amended.text);
  }
  const said = h.heard(sup).join("\n");
  assert.match(
    said,
    /INCIDENT I\d+ \(architecture, attend\) on the Lead of L1 \(Build\)[^]*What was seen: L1-T2 widened to hold c\.txt, because the parser lives there/,
  );
  assert.match(
    said,
    /INCIDENT I\d+ \(goal-turned, attend\) on the Lead of L1[^]*What was seen: L1-T2 changed what it is for, because the parser lives there; was: g; now: parse the header instead/,
  );
  assert.equal(
    said.match(/\((architecture|goal-turned), attend\)/g)!.length,
    2,
    "new acceptance, holding less, or where to start reading is the Lead's own business",
  );
});

test("a task gone quiet until it stalls, or stopped on a refused call, is a stall W tells whoever supervises once, under a name of its own and not the struggling pattern's", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const said = () => h.heard(sup).join("\n");
  for (const round of [1, 2, 3]) {
    await h.call(peer, "peer", "done", { outcome: "complete", summary: `round ${round}` });
    await h.call(lane.lead!, "lead", "rework", { task: "L1-T1", text: `not yet, round ${round}` });
  }
  assert.doesNotMatch(
    said(),
    /\((stalled|struggling), attend\)/,
    "sent back again is what W's rework count reads, not a stall",
  );
  // A turn counts the Peer as heard from when its last record is no older than the turn: this one starts after it.
  const heard = h.ledger().agents[peer]!;
  while (Date.now() <= Math.max(heard.recordedAt ?? 0, heard.spokeAt ?? 0)) await sleep(1);
  for (const words of ["Looking at it.", "Still looking.", "Still."]) {
    await h.beginTurn(peer);
    await h.endTurn(peer, words);
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");
  assert.match(
    said(),
    /INCIDENT I\d+ \(stalled, attend\) on the Peer on L1-T1 \(Clean build\)[^]*What was seen: its Peer ended 2 turns without a hand-back or an ask/,
  );
  assert.equal(
    said().match(/\(stalled, attend\) on the Peer on L1-T1/g)!.length,
    1,
    "a turn quiet after it stalled is the same stall",
  );
  assert.match(
    (await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" })).text,
    /^L1-T1 is in the merge queue\. Its last hand-back came before your last rework, so what it says may not be what its branch holds\./,
    "accepting it then takes the branch as it is, and the Lead is told the hand-back is older",
  );

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [parser] });
  const beside = h.ledger().tasks["L1-T2"]!.peer!;
  await h.beginTurn(beside);
  await h.endTurn(beside, "", {
    type: "tool_call",
    name: "Bash",
    status: "failed",
    error: { content: "Permission to use Bash with command git log has been denied." },
    detail: { type: "shell", command: "git log" },
  });
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "stalled", "a turn that ends on a refused call stalls at once");
  assert.deepEqual(
    h
      .events("turn.silent")
      .map(({ task, denied, refused }) => [task, denied, refused])
      .at(-1),
    ["L1-T2", "Bash: git log", true],
  );
  assert.match(
    said(),
    /\(stalled, attend\) on the Peer on L1-T2 \(Parser\)[^]*What was seen: its Peer's last call was refused: Bash: git log/,
  );
});

test("how many quiet turns stall a task, and how much a seat may say after a refused call and still be stopped on it, are settings", async () => {
  const { h, peer } = await laneWithPeer({ attention: { silentTurns: 3, quietChars: 300 } });
  const heard = h.ledger().agents[peer]!;
  while (Date.now() <= Math.max(heard.recordedAt ?? 0, heard.spokeAt ?? 0)) await sleep(1);
  for (const words of ["Looking at it.", "Still looking."]) {
    await h.beginTurn(peer);
    await h.endTurn(peer, words);
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "two quiet turns are not yet three");
  await h.beginTurn(peer);
  await h.endTurn(peer, "Still.");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "stalled");

  const { h: other, peer: stopped } = await laneWithPeer({ attention: { quietChars: 300 } });
  await other.beginTurn(stopped);
  await other.endTurn(
    stopped,
    "I could not read the log, so I will explain at length what I would have done. ".repeat(3),
    {
      type: "tool_call",
      name: "Bash",
      status: "failed",
      error: { content: "Permission to use Bash with command git log has been denied." },
      detail: { type: "shell", command: "git log" },
    },
  );
  assert.equal(
    other.ledger().tasks["L1-T1"]!.status,
    "stalled",
    "a few sentences past a refusal is still stopped on it",
  );
});

test("a seat whose context nears full, as its agent reports it, is told once while it stays so, and nothing acts on it", async () => {
  const { h, sup, peer } = await laneWithPeer();
  const used = (tokens: number) =>
    Object.assign(h.agents.get(peer)!, {
      lastUsage: { contextWindowUsedTokens: tokens, contextWindowMaxTokens: 200_000 },
    });
  const told = () =>
    h
      .heard(sup)
      .join("\n")
      .match(/\(context-pressure, attend\)/g)?.length ?? 0;
  used(120_000);
  await h.tick();
  assert.equal(told(), 0, "60% is room enough");
  used(170_000);
  await h.tick();
  await h.tick();
  assert.match(
    h.heard(sup).join("\n"),
    /INCIDENT I\d+ \(context-pressure, attend\) on the Peer on L1-T1[^]*What was seen: its context is 85% full: 170000 of 200000 tokens/,
  );
  assert.equal(told(), 1, "once while it stays full");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "nothing acts on it");
});
