import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamMessage } from "../../server/adapters/paseo/stream.ts";
import { type FactCase, factCases, patternCases } from "../eval/cases.ts";
import { again, editCall, kit, opening, piRow, play, rules } from "./seat-replay.ts";

const shell = (seq: number, command: string, exit = 0, refused = false) => {
  const row = again(piRow(11), `s${seq}`, seq, (detail) => Object.assign(detail, { command, exitCode: exit }));
  if (refused)
    Object.assign(row.event.item!, {
      status: "failed",
      error: { content: `Permission to use Bash with command ${command} has been denied.` },
    });
  return row;
};

const edit = (seq: number, detail: Record<string, unknown>) =>
  again(editCall(), `e${seq}`, seq, (given) => Object.assign(given, detail));

const item = (seq: number, value: Record<string, unknown>) => {
  const row = again(piRow(11), `i${seq}`, seq);
  Object.assign(row.event, { item: value });
  return row;
};

/** The case as the rows of one turn of a seat's timeline, after its instruction. */
function turnOf(one: FactCase): StreamMessage[] {
  const rows: StreamMessage[] = [];
  if (one.command !== undefined) rows.push(shell(2, one.command));
  if (one.edit) rows.push(edit(2, { type: "edit", ...one.edit }));
  if (one.read) rows.push(edit(2, { type: "read", filePath: one.read, content: "KEY=1" }));
  (one.steps ?? []).forEach((step, index) => {
    const seq = index + 2;
    if ("shell" in step) rows.push(shell(seq, step.shell, step.exit, step.refused));
    else if ("edit" in step)
      rows.push(edit(seq, { type: "edit", filePath: step.edit, oldString: "a", newString: "b" }));
    else if ("think" in step) rows.push(item(seq, { type: "reasoning", text: step.think }));
    else if ("say" in step) rows.push(item(seq, { type: "assistant_message", text: step.say, messageId: `m${seq}` }));
    else rows.push(item(seq, { type: "compaction" }));
  });
  return [
    { event: { type: "turn_started", turnId: "t" } },
    opening()[1]!,
    ...rows,
    { event: { type: "turn_completed", turnId: "t" } },
  ];
}

/** Whether the code raises the case's fact of that turn, which ends with the case's hand-back if it has one. */
function raises(one: FactCase): boolean {
  return play(turnOf(one), rules(one.rules), one.handback).some((fact) => fact.kind === one.fact);
}

test("the code-fact eval set: every case raises its fact as it expects, and each known miss still misses", () => {
  const facts = new Set(Object.keys(kit.patterns));
  const wrong = factCases().flatMap((one) => {
    assert.ok(!facts.has(one.fact), `${one.fact} is a pattern, not a code fact`);
    const hit = raises(one) === one.expect;
    return hit === !one.known ? [] : [`${one.fact} ${one.expect ? "+" : "-"} ${one.source}: ${JSON.stringify(one)}`];
  });
  assert.deepEqual(wrong, []);
});

test("the pattern eval set asks each pattern of what it reads, with two cases each way, and a line where it is asked one", () => {
  const cases = patternCases();
  for (const one of cases) {
    const pattern = kit.patterns[one.pattern];
    assert.ok(pattern, `${one.pattern} is no pattern of the kit`);
    assert.ok(pattern.reads.includes(one.item), `${one.pattern} does not read a ${one.item}: ${one.text}`);
    assert.equal(
      Boolean(one.rule),
      Boolean(pattern.each),
      `${one.pattern} is asked a line only if it is asked each rule`,
    );
  }
  for (const id of Object.keys(kit.patterns))
    for (const expect of [true, false])
      assert.ok(
        cases.filter((one) => one.pattern === id && one.expect === expect).length >= 2,
        `${id} has two ${expect ? "positives" : "negatives"}`,
      );
});
