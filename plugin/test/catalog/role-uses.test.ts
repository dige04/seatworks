import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { loadKit } from "../../server/catalog/kit/kit.ts";
import { refusalSettings } from "../../server/catalog/seat/refusals.ts";
import { seatBin } from "../../server/catalog/seat/seat-bin.ts";
import { usedSettings } from "../../server/catalog/seat/seat-files.ts";
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

test("a role that uses git runs the real one: no shim on its PATH and no deny rule for it", () => {
  const kit = loadKit(PLUGIN);
  const supervisor = { ...kit.roles.find((role) => role.role === "supervisor")!, uses: ["gh", "git"] };
  const state = tempDir("sw2-uses-git-state-");
  const own = seatBin(kit, state, supervisor)!;
  assert.deepEqual(
    readdirSync(own).sort(),
    ["sgit", ...Object.keys(kit.refused).filter((name) => name !== "gh")].sort(),
    "neither the git shim nor gh's refusal is in its directory, and sgit runs the real git",
  );
  assert.ok(readdirSync(seatBin(kit, state)!).includes("git"), "every other seat still runs git through the shim");
});

test("what a role uses is neither denied nor sandboxed in its settings; a role that uses nothing keeps both", () => {
  const kit = loadKit(PLUGIN);
  const supervisor = kit.roles.find((role) => role.role === "supervisor")!;
  const settings = {
    permissions: { deny: ["Edit", "Bash(git merge *)", "Bash(git -C * reset *)", "Bash(gh)", "Bash(sleep *)"] },
    sandbox: { enabled: true, excludedCommands: ["docker"] },
  };
  assert.deepEqual(usedSettings({ ...supervisor, uses: ["gh", "git"] }, settings), {
    permissions: { deny: ["Edit", "Bash(sleep *)"] },
    sandbox: { enabled: true, excludedCommands: ["docker", "gh", "gh *", "git", "git *", "sgit", "sgit *"] },
  });
  assert.equal(usedSettings(supervisor, settings), settings);
});

test("GitLab is the forge too: a seat is refused glab as it is gh, a GitLab token is masked and is a secret to the watch", async () => {
  const kit = loadKit(PLUGIN);
  assert.ok("glab" in kit.refused, "glab is refused like gh");
  assert.ok(readdirSync(seatBin(kit, tempDir("sw2-glab-state-"))!).includes("glab"));
  const { mask } = await import("../../server/core/mask.ts");
  assert.equal(mask("token glpat-AbCdEfGhIjKlMnOpQrSt12 here"), "token [token] here");
  assert.match("glpat-AbCdEfGhIjKlMnOpQrSt12", new RegExp(kit.attention.secretString));
});
