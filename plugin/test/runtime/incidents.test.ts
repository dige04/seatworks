import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { flowRpc } from "../../shared/rpc.ts";
import { laneWithPeer } from "./harness.ts";
import { book, hookAgent, notice } from "./noticed.ts";

test("an incident's life: seen, routed, listed, marked, closed", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  await h.call(lead, "lead", "add_tasks", {
    tasks: [
      {
        key: "r",
        title: "Receipt",
        goal: "g",
        acceptance: ["a"],
        holds: ["src/receipt/"],
        outOfScope: ["the rest"],
        parallel: true,
      },
    ],
  });
  const beside = h.ledger().tasks["L1-T2"]!.peer!;
  const mark = (seat: string, id: string, verdict: string, note?: string) =>
    h.call(seat, "supervisor", "mark_incident", { id, verdict, ...(note ? { note } : {}) });
  const listing = async (seat: string, closed = false) =>
    (await h.call(seat, "supervisor", "incidents", { closed })).text;
  const letters = (seat: string, id: string) => h.heard(seat).filter((text) => text.includes(`INCIDENT ${id} `)).length;

  const results = await Promise.all([
    notice(h, peer, "stuck", "attend", "the same action failing 3 times"),
    notice(h, peer, "stuck", "attend", "the same action failing 3 times"),
    notice(h, peer, "stuck", "attend", "again"),
  ]);
  assert.equal(results.flatMap((result) => result.opened).length, 1, "only the first sighting opens anything");
  assert.deepEqual(
    [book(h).I1!.count, book(h).I1!.quote, book(h).I1!.later],
    [3, "the same action failing 3 times", "again"],
    "counted, and what was seen after it was told kept beside what was told",
  );
  await notice(h, beside, "stuck", "attend", "the same action failing 3 times: npm run build");
  await notice(h, peer, "destructive", "page", "rm -rf /");
  assert.deepEqual(Object.keys(book(h)), ["I1", "I2", "I3"], "another seat, or another kind, is another incident");

  await notice(h, peer, "test-weakened");
  await notice(h, lead, "long-turn");
  assert.match(
    h.heard(sup).join("\n"),
    /INCIDENT I4 \(test-weakened, attend\) on the Peer/,
    "one about a Peer goes to whoever supervises, W's only reader",
  );
  assert.match(
    h.heard(sup).join("\n"),
    /INCIDENT I5 \(long-turn, attend\) on the Lead/,
    "and so does one about the Lead",
  );
  assert.doesNotMatch(h.heard(lead).join("\n"), /INCIDENT/, "a Lead is never told one");
  assert.match(
    (await h.call(lead, "lead", "incidents", {})).text,
    /Unknown tool incidents/,
    "nor may it read or mark one",
  );
  assert.equal((await mark(sup, "I4", "useful", "it was going round")).ok, true);
  assert.match(
    await listing(sup, true),
    /I4 \[attend, closed, told [^\]]*, marked useful\]/,
    "the Supervisor sees the mark",
  );
  assert.equal((await mark(sup, "I9", "useful")).ok, false, "an incident that is not there is refused");

  await notice(h, beside, "stuck", "attend", "the same action failing 3 times: npm run build");
  assert.equal(letters(sup, "I2"), 1, "a standing condition is told once, however often it is seen");
  const noted = await mark(
    sup,
    "I2",
    "noise",
    "expected: a normal retry of `curl -H 'Authorization: Bearer 9f8e7d6c5b4a39281706'`",
  );
  assert.equal(noted.ok, true, noted.text);
  assert.doesNotMatch(
    book(h).I2!.note!,
    /9f8e7d6c5b4a39281706/,
    "a secret quoted in a note is masked before it is kept",
  );
  assert.match(book(h).I2!.note!, /^expected: a normal retry/);
  assert.deepEqual(
    [book(h).I2!.open, book(h).I1!.open, book(h).I1!.label],
    [false, true, undefined],
    "the mark closes only its own",
  );
  const again = await notice(h, beside, "stuck", "attend", "the same action failing 3 times: npm run build");
  assert.deepEqual(again.opened, [], "the same words marked noise on this seat open nothing new");
  assert.deepEqual(
    [book(h).I2!.count, letters(sup, "I2")],
    [3, 1],
    "they are counted, and nobody is asked about them twice",
  );
  const other = await notice(h, beside, "stuck", "attend", "the same action failing 3 times: src/patch.js is missing");
  assert.deepEqual(
    other.opened.map((incident) => incident.id),
    ["I6"],
    "different words are a different thing",
  );
  assert.equal((await mark(sup, "I3", "noise", "expected: its own scratch directory")).ok, true);
  assert.deepEqual(
    (await notice(h, peer, "destructive", "page", "rm -rf /")).opened.map((incident) => incident.id),
    ["I7"],
    "a page is never settled away",
  );

  h.agents.get(lead)!.archivedAt = new Date().toISOString();
  await notice(h, peer, "suppressed");
  assert.match(
    h.heard(sup).join("\n"),
    /INCIDENT I8 \(suppressed, attend\) on the Peer/,
    "with its Lead gone, as ever",
  );

  await notice(h, peer, "stand-in", "attend", "I'll stub it: curl -H 'Authorization: Bearer 9f8e7d6c5b4a39281706' api");
  assert.doesNotMatch(
    `${h.heard(sup).join("\n")}\n${await listing(sup)}`,
    /9f8e7d6c5b4a39281706/,
    "a secret a seat wrote is masked wherever its words reach whoever supervises",
  );

  await h.runtime.archived(hookAgent(h, beside));
  const closedWithSeat = await listing(sup);
  assert.match(
    closedWithSeat,
    /I6 \[attend, closed, told [^\]]*, not marked\]/,
    "closed with its seat, it still waits to be marked",
  );
  assert.match(
    closedWithSeat,
    /What they were asked:\n(- .*\n)*- L1-T1 Clean build: goal g; acceptance a; hints a\.txt; out of scope the rest of the repository/,
  );
  assert.match(closedWithSeat, /- L1-T2 Receipt: goal g; acceptance a; holds src\/receipt\/; out of scope the rest/);
  assert.equal((await mark(sup, "I6", "useful")).ok, true);
  assert.doesNotMatch(await listing(sup), /I6 \[/, "and once marked it waits no more");

  const flow = await h.rpc(flowRpc, { project: h.project.slug });
  assert.ok("watch" in flow, JSON.stringify(flow));
  assert.equal(flow.watch.incidents.find((card) => card.id === "I7")?.title, "Ran a command that cannot be undone");

  const decided = await notice(h, peer, "big-decision", "attend", "We keep every total in one table.");
  assert.match(
    h.heard(sup).join("\n"),
    new RegExp(`INCIDENT ${decided.opened[0]!.id} \\(big-decision[^]*?\\nNext: [^\\n]*Nothing, if `),
    "a pattern's Next is the catalog's, as a moment's is",
  );

  const unnumbered = JSON.stringify({ items: book(h) });
  writeFileSync(join(h.project.state, "incidents.json"), unnumbered);
  await assert.rejects(notice(h, peer, "turning"), /Nothing was written over it/);
  assert.equal(
    readFileSync(join(h.project.state, "incidents.json"), "utf-8"),
    unnumbered,
    "a book missing its numbering is not read as counting from I1 and written over",
  );
  writeFileSync(join(h.project.state, "incidents.json"), "{ not json");
  await assert.rejects(notice(h, peer, "stuck"), /could not be read: [\s\S]*Nothing was written over it/);
  await assert.rejects(notice(h, peer, "destructive", "page", "rm -rf /srv/data"));
  assert.match(
    h.heard(sup).join("\n"),
    /rm -rf \/srv\/data[^]*incident book could not be read/,
    "a page reaches whoever supervises though the book cannot keep it",
  );
  assert.equal(
    (await h.call(sup, "supervisor", "incidents", {})).ok,
    false,
    "a book that cannot be read is refused, not started again",
  );
});

test("every signal the watch raises is told to whoever supervises, with no switch for any of them, and a page always goes", async () => {
  const { h, sup, peer } = await laneWithPeer();
  await notice(h, peer, "stuck", "attend", "the same action failing 3 times");
  await notice(h, peer, "suppressed", "attend", "adds @ts-ignore");
  await notice(h, peer, "stand-in", "attend", "I'll build a stub for the parser.");
  await notice(h, peer, "destructive", "page", "rm -rf build");
  assert.deepEqual(
    Object.values(book(h)).map((item) => [item.kind, item.told !== undefined, item.held ?? null]),
    [
      ["stuck", true, null],
      ["suppressed", true, null],
      ["stand-in", true, null],
      ["destructive", true, null],
    ],
  );
  await h.idle(sup);
  assert.match(h.heard(sup).join("\n"), /\(suppressed, attend\)[^]*\(stand-in, attend\)/);
});
