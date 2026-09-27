import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

test("a challenge to a brief or a directive is answered with why, whether the plan changes or stands", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const asked = await h.call(peer, "peer", "ask", {
    question: "May the task brake with rim brakes?",
    disputes: "a parachute slows it",
    tried: "the largest parachute the frame takes stops the bike in 14 m, not 5",
    bestGuess: "rim brakes",
  });
  assert.equal(asked.ok, true, asked.text);
  const challenge = Object.values(h.ledger().asks)[0]!;
  assert.equal(challenge.kind, "challenge");
  await h.idle(lead);
  assert.match(h.agents.get(lead)!.sent.join("\n"), /CHALLENGE [^\n]*\n\nDisputes: a parachute slows it\n/);
  const bare = await h.call(lead, "lead", "answer", { ask: challenge.id, text: "Keep the parachute." });
  assert.equal(bare.ok, false, "keeping the plan takes a reason as much as changing it");
  assert.match(bare.text, /why/);
  const kept = await h.call(lead, "lead", "answer", {
    ask: challenge.id,
    text: "Keep the parachute.",
    why: "the Human asked for a parachute rig to test",
    verdict: "alternative",
  });
  assert.equal(kept.ok, true, kept.text);
  await h.idle(peer);
  assert.match(
    h.agents.get(peer)!.sent.join("\n"),
    /Keep the parachute\.\n\nWeighed: another sound option; the plan stands\. Why: the Human asked for a parachute rig/,
  );

  const up = await h.call(lead, "lead", "ask", {
    kind: "challenge",
    text: "The directive's choice of a parachute cannot stop the bike in 5 m.",
    default: "build rim brakes",
  });
  assert.equal(up.ok, true, up.text);
  const second = Object.values(h.ledger().asks)[1]!;
  assert.equal((await h.call(sup, "supervisor", "answer", { ask: second.id, text: "Go on." })).ok, false);
  assert.equal(
    (await h.call(sup, "supervisor", "answer", { ask: second.id, text: "Go on.", why: "it fails", verdict: "changes" }))
      .ok,
    true,
  );
});

test("whoever answers a challenge says how it weighs: it changes the plan, it is another sound option, or it is not worth stopping for", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  await h.call(peer, "peer", "ask", { question: "Rim brakes?", disputes: "a parachute", tried: "14 m, not 5" });
  const id = Object.values(h.ledger().asks)[0]!.id;
  const unweighed = await h.call(lead, "lead", "answer", { ask: id, text: "Use rim brakes.", why: "it stops in 4 m" });
  assert.equal(unweighed.ok, false);
  assert.match(unweighed.text, /verdict/);
  const weighed = await h.call(lead, "lead", "answer", {
    ask: id,
    text: "Use rim brakes.",
    why: "it stops in 4 m",
    verdict: "changes",
  });
  assert.equal(weighed.ok, true, weighed.text);
  assert.equal(h.ledger().asks[id]!.verdict, "changes");
  await h.idle(peer);
  assert.match(h.agents.get(peer)!.sent.join("\n"), /Weighed: it changes the plan\. Why: it stops in 4 m/);
});
