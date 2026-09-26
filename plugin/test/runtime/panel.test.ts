import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { notice } from "./noticed.ts";
import { paseoConfigPath, stateRoot } from "../../server/core/paths.ts";
import { contracts } from "../../shared/rpc.ts";
import type { Layer } from "../../shared/settings.ts";
import { settle } from "./fake-timeline.ts";
import { harness, laneWithPeer } from "./harness.ts";

test("what the watch sees reaches whoever supervises, the Flow tab shows what waits for somebody to be seated, and a call its harness refused is recorded though it never reached the desk", async (t) => {
  const { h, sup, timeline } = await laneWithPeer();
  const working = h.runtime.kit.roles.find((role) => role.role === "peer")!;
  const label = working.label;
  t.after(() => void (working.label = label));
  working.label = "Coder";
  timeline.beat("turn_started", "t1");
  const edit = {
    type: "edit",
    filePath: "src/a.ts",
    oldString: "const x = f();",
    newString: "// @ts-ignore\nconst x = f();",
  };
  timeline.add({ type: "tool_call", callId: "c1", name: "Edit", status: "completed", detail: edit }, "t1");
  const push = { type: "shell", command: "git push --force origin main" };
  timeline.add({ type: "tool_call", callId: "c2", name: "Bash", status: "running", detail: push }, "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await h.idle(sup);
  const sent = h.agents.get(sup)!.sent.join("\n");
  assert.match(sent, /INCIDENT I2 \(destructive, page\)/, "a page is irreversible and often done already");
  assert.match(sent, /INCIDENT I1 \(suppressed, attend\)/, "and the rest is told as soon");
  Object.assign(h.agents.get(sup)!, { archivedAt: new Date().toISOString() });
  await notice(h, h.ledger().tasks["L1-T1"]!.peer!, "test-weakened", "attend", "src/a.test.ts: 3 assertions become 1");
  const held = await h.rpc(contracts.flow, { project: h.project.slug });
  assert.ok("watch" in held);
  assert.deepEqual(
    held.watch.incidents.filter((item) => item.held).map((item) => [item.name, item.quote, item.held]),
    [["Coder · L1-T1 Clean build", "src/a.test.ts: 3 assertions become 1", "nobody"]],
    "the card names the seat by its role as the kit calls it and its task, and shows the step and why it waits",
  );
  Object.assign(h.agents.get(sup)!, { archivedAt: null });

  await h.beginTurn(sup);
  await h.endTurn(sup, "Opening the lane.", {
    type: "tool_call",
    callId: "c1",
    name: "mcp__team__open_lane",
    status: "failed",
    error: {
      content: "InputValidationError: mcp__team__open_lane was called with input that could not be parsed as JSON.",
    },
    detail: { type: "unknown", input: { __unparsedToolInput: { raw: '{"title": "Build"' } }, output: null },
  });
  // No watch follows the Supervisor and the call never reached the desk, so this log is its only record.
  assert.deepEqual(
    h.events("call.malformed").map(({ tool, role }) => [tool, role]),
    [["mcp__team__open_lane", "supervisor"]],
  );
  assert.deepEqual(
    h.events("tool").filter((event) => !event.ok),
    [],
    "and no failed desk call was recorded",
  );
  // Paseo hands the hook the whole session, so the next turn carries the same failed call again.
  await h.endTurn(sup, "Now the task.", {
    type: "tool_call",
    callId: "c2",
    name: "status",
    status: "completed",
    detail: {},
  });
  assert.equal(h.events("call.malformed").length, 1);
  const view = await h.rpc(contracts.flow, { project: h.project.slug });
  assert.ok("watch" in view);
  assert.deepEqual(
    view.watch.trouble.map((entry) => entry.kind),
    ["call.malformed"],
    "no letter carries it, so the panel is where it is seen",
  );
});

test("Migrate shows what you took in of the kit, when that cannot be read, as a step for you, and writes nothing over it", async () => {
  const h = harness();
  const taken = join(stateRoot(), "content.json");
  mkdirSync(stateRoot(), { recursive: true });
  writeFileSync(taken, "{not json");
  const plan = await h.rpc(contracts.migrate, { apply: false });
  const steps = plan.steps.filter((step) => step.kind === "content");
  assert.deepEqual(
    steps.map((step) => [step.auto, step.where]),
    [[false, "machine"]],
  );
  assert.match(steps[0]!.what, /content\.json is there but could not be read/);
  assert.equal(readFileSync(taken, "utf-8"), "{not json");
});

test("a save is refused only for what it adds, and Migrate offers to drop a role the kit no longer has", async () => {
  const h = harness();
  h.machineSettings({ roles: { pager: { harness: "claude" } } });
  const save = async (values: Layer) => {
    const read = await h.rpc(contracts.settingsRead, { project: h.project.slug });
    return h.rpc(contracts.settingsWrite, { project: h.project.slug, revision: read.revision, values });
  };
  assert.equal(
    (await save({ hitl: { on: true } })).status,
    "saved",
    "the machine's old role does not block the project",
  );
  const refused = await save({ roles: { ghost: { harness: "claude" } } });
  assert.deepEqual(
    [refused.status, refused.status === "invalid" && refused.error],
    ["invalid", "The project settings name an unknown role ghost"],
  );

  const plan = await h.rpc(contracts.migrate, { apply: false });
  const step = plan.steps.find((each) => each.kind === "settings" && each.where === "machine");
  assert.deepEqual(step?.detail, ["roles.pager"]);
  // Paseo's config is always there where a plugin runs, and applying reconciles the seats' providers into it.
  mkdirSync(dirname(paseoConfigPath()), { recursive: true });
  writeFileSync(paseoConfigPath(), "{}\n");
  await h.rpc(contracts.migrate, { apply: true });
  const machine = JSON.parse(readFileSync(join(stateRoot(), "settings.json"), "utf-8")) as { roles?: object };
  assert.deepEqual(machine.roles, {});
});
