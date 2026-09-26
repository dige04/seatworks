import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { contentChanges, takeIn } from "../../server/upkeep/content.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

/** A kit with the owner's state beside it, taken in once as it ships. */
function world() {
  const state = tempDir("sw2-state-");
  const kit = { ...makeKit(), own: join(state, "own") };
  writeFileSync(join(kit.dir, "content", "guides", "PLANS.md"), "# Plans\n");
  assert.deepEqual(contentChanges(kit, state), [], "the first reading takes everything in as it ships");
  const ship = (path: string, text: string) => {
    mkdirSync(join(kit.dir, "content", path, ".."), { recursive: true });
    writeFileSync(join(kit.dir, "content", path), text);
  };
  return { kit, state, ship };
}

test("what the kit ships differently is told until the owner has seen it, their own copy named as the one in use", () => {
  const { kit, state, ship } = world();
  ship("prompts/LEAD.md", "A new brief.");
  ship("skills/supervisor/plan-check/SKILL.md", "---\nname: plan-check\ndescription: checks a plan, better\n---\n");
  ship("guides/PLANS.md", "# Plans, rewritten\n");
  mkdirSync(join(kit.own, "prompts"), { recursive: true });
  writeFileSync(join(kit.own, "prompts", "LEAD.md"), "My own brief.");
  assert.deepEqual(
    contentChanges(kit, state).map((change) => [change.unit, change.kind, change.change, change.kept]),
    [
      ["guides/PLANS.md", "guide", "changed", false],
      ["prompts/LEAD.md", "prompt", "changed", true],
      ["skills/supervisor/plan-check", "skill", "changed", false],
    ],
  );
  takeIn(kit, state, ["prompts/LEAD.md", "guides/PLANS.md"]);
  assert.deepEqual(
    contentChanges(kit, state).map((change) => change.unit),
    ["skills/supervisor/plan-check"],
    "what was seen is not told again",
  );

  const taken = join(state, "content.json");
  writeFileSync(taken, "{not json");
  assert.throws(() => contentChanges(kit, state), /content\.json is there but could not be read/);
  assert.throws(() => takeIn(kit, state, ["guides/PLANS.md"]), /content\.json is there but could not be read/);
  assert.equal(readFileSync(taken, "utf-8"), "{not json", "what the owner took in is not written over with everything");
});
