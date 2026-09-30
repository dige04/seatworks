import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { loadKit } from "../../server/catalog/kit/kit.ts";
import { refusalSettings } from "../../server/catalog/seat/refusals.ts";
import { seatBin } from "../../server/catalog/seat/seat-bin.ts";
import { fileURLToPath } from "node:url";
import { tempDir } from "../tempdir.ts";

const PLUGIN = fileURLToPath(new URL("../..", import.meta.url));

test("a role that uses a command the kit refuses finds it on its PATH and in its settings, and every other role is still refused it", () => {
  const kit = loadKit(PLUGIN);
  const supervisor = { ...kit.roles.find((role) => role.role === "supervisor")!, uses: ["gh"] };
  const lead = kit.roles.find((role) => role.role === "lead")!;
  const state = tempDir("sw2-uses-state-");

  const shared = seatBin(kit, state)!;
  const own = seatBin(kit, state, supervisor)!;
  assert.ok(readdirSync(shared).includes("gh"), "a seat of any other role is refused gh on its PATH");
  assert.notEqual(own, shared, "the role that uses it has a directory of its own");
  assert.deepEqual(
    readdirSync(own).sort(),
    ["git", ...Object.keys(kit.refused).filter((name) => name !== "gh")].sort(),
    "its git is still the shim, and what it does not use is still refused",
  );
  assert.equal(seatBin(kit, state, lead), shared, "a role that uses nothing refused shares the one directory");

  const denied = (role: typeof lead) =>
    JSON.stringify(refusalSettings(kit, kit.harnesses["claude"]!, role, state)).includes("Bash(gh");
  assert.equal(denied(lead), true);
  assert.equal(denied(supervisor), false);
});
