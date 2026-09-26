import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test } from "node:test";
import { applyModels } from "../../server/catalog/paseo/models.ts";
import { applyReconcile } from "../../server/catalog/paseo/providers.ts";
import { resolveTeam } from "../../server/catalog/team/team.ts";
import { nodeBin, paseoConfigPath } from "../../server/core/paths.ts";
import { makeKit } from "../kit.ts";

type Provider = {
  extends?: string;
  label?: string;
  command?: string[];
  env?: Record<string, string>;
  description?: string;
  models?: unknown;
  additionalModels?: unknown;
  paseoTools?: unknown;
};
type Config = {
  agents: { providers: Record<string, Provider> };
  daemon: { agentProfiles: { id: string; provider?: string }[] };
  plugins?: unknown;
};
const written = () => JSON.parse(readFileSync(paseoConfigPath(), "utf-8")) as Config;
const ours = () =>
  Object.keys(written().agents.providers)
    .filter((id) => id.startsWith("sw2-"))
    .sort();

/** Paseo's config as a machine that ran an older plugin leaves it: the owner's entries beside providers and profiles of the kit's. */
function owners(): Config {
  const config: Config = {
    agents: {
      providers: {
        claude: { env: { TOKEN: "keep" } },
        peer: { extends: "acp" },
        "sw2-peer": { extends: "acp" },
        "sw2-peer-omp": {
          extends: "claude",
          env: { MY_KEY: "x", CLAUDE_CODE_DISABLE_CRON: "1", CLAUDE_CONFIG_DIR: "/old", SEATWORKS_SLUG: "old" },
          description: "stale",
          models: [{ id: "glm", label: "GLM" }],
        },
      },
    },
    daemon: {
      agentProfiles: [{ id: "mine" }, { id: "sw2-peer" }, { id: "sw2-lead-claude", provider: "sw2-lead-claude" }],
    },
    plugins: { "seatworks-v2": { source: "directory", path: "/kit" } },
  };
  mkdirSync(dirname(paseoConfigPath()), { recursive: true });
  writeFileSync(paseoConfigPath(), JSON.stringify(config), { mode: 0o600 });
  return config;
}

test("with no project attached, a load writes no provider of the kit's and takes off every one it wrote before, leaving the owner's own and the plugin's entry alone", () => {
  const kit = makeKit();
  const before = owners();
  assert.deepEqual(applyReconcile(kit, []).sort(), [
    "profile sw2-lead-claude removed",
    "profile sw2-peer removed",
    "provider sw2-peer removed",
    "provider sw2-peer-omp removed",
  ]);
  const config = written();
  assert.deepEqual(ours(), [], "nothing is wanted until a project is attached");
  assert.deepEqual(
    [config.agents.providers.claude, config.agents.providers.peer, config.plugins],
    [before.agents.providers.claude, before.agents.providers.peer, before.plugins],
  );
  assert.deepEqual(config.daemon.agentProfiles, [{ id: "mine" }]);
  const held = readFileSync(paseoConfigPath(), "utf-8");
  assert.deepEqual(applyReconcile(kit, []), []);
  assert.equal(readFileSync(paseoConfigPath(), "utf-8"), held, "a second load writes nothing");
});

test("an attached project's team gets one provider per role, on the agent that role has there, and no profile; the owner's keys on one it keeps stay, and a second pass changes nothing", () => {
  const kit = makeKit();
  owners();
  const changed = applyReconcile(kit, [resolveTeam(kit)]);
  assert.deepEqual(changed.sort(), [
    "profile sw2-lead-claude removed",
    "profile sw2-peer removed",
    "provider sw2-lead-claude",
    "provider sw2-peer removed",
    "provider sw2-peer-omp",
    "provider sw2-scribe-omp",
    "provider sw2-supervisor-claude",
  ]);
  assert.deepEqual(
    ours(),
    ["sw2-lead-claude", "sw2-peer-omp", "sw2-scribe-omp", "sw2-supervisor-claude"],
    "exactly the pairs the default team seats, the Scribe on the agent of the Peer it follows",
  );
  assert.equal(statSync(paseoConfigPath()).mode & 0o777, 0o600, "a private config is not widened");
  const { agents, daemon } = written();
  const lead = agents.providers["sw2-lead-claude"]!;
  assert.deepEqual(
    [lead.extends, lead.label, lead.command, lead.env?.SEATWORKS_ROLE, lead.env?.SEATWORKS_KIT],
    ["claude", "Lead · Claude Code (sw2)", [nodeBin(), `${kit.dir}/bin/seat-room.mjs`], "lead", kit.dir],
  );
  assert.equal(
    lead.models,
    undefined,
    "Paseo lists the agent's own models: replacing that list hid every model but the chosen one",
  );
  assert.deepEqual(lead.additionalModels, [{ id: "opus", label: "Opus", isDefault: true }]);
  const peer = agents.providers["sw2-peer-omp"]!;
  assert.equal(peer.extends, "omp");
  assert.deepEqual(
    Object.keys(peer.env ?? {}).sort(),
    ["MY_KEY", "SEATWORKS_AGENT_BIN", "SEATWORKS_HARNESS", "SEATWORKS_KIT", "SEATWORKS_ROLE"],
    "what the kit manages is its own to drop, and the owner's keys stay",
  );
  assert.deepEqual(
    [peer.description, peer.models, peer.additionalModels],
    [undefined, undefined, [{ id: "glm", label: "GLM", isDefault: true }]],
  );
  assert.deepEqual(peer.paseoTools, { enabled: false });
  assert.deepEqual(daemon.agentProfiles, [{ id: "mine" }], "nothing reads a profile, so only the owner's own stay");
  const held = readFileSync(paseoConfigPath(), "utf-8");
  assert.deepEqual(applyReconcile(kit, [resolveTeam(kit)]), []);
  assert.equal(readFileSync(paseoConfigPath(), "utf-8"), held, "a second pass writes nothing");

  assert.deepEqual(applyReconcile(kit, [resolveTeam(kit, { roles: { lead: { model: "haiku" } } })]), [
    "provider sw2-lead-claude",
  ]);
  assert.deepEqual(
    written().agents.providers["sw2-lead-claude"]!.additionalModels,
    [{ id: "haiku", label: "Haiku", isDefault: true }],
    "the model it starts on is the one chosen",
  );
  const onClaude = resolveTeam(kit, {}, { roles: { peer: { harness: "claude" } } });
  applyReconcile(kit, [resolveTeam(kit), onClaude]);
  assert.deepEqual(
    ours(),
    [
      "sw2-lead-claude",
      "sw2-peer-claude",
      "sw2-peer-omp",
      "sw2-scribe-claude",
      "sw2-scribe-omp",
      "sw2-supervisor-claude",
    ],
    "two projects seat what either team uses",
  );
  applyReconcile(kit, [onClaude]);
  assert.deepEqual(
    ours(),
    ["sw2-lead-claude", "sw2-peer-claude", "sw2-scribe-claude", "sw2-supervisor-claude"],
    "and what no team uses any more is taken off",
  );

  const listed = makeKit();
  applyModels(listed, {
    omp: {
      at: "",
      error: null,
      models: [
        { id: "claude-in-omp", label: "Claude in omp" },
        { id: "glm", label: "GLM" },
      ],
    },
  });
  applyReconcile(listed, [resolveTeam(listed, { roles: { lead: { harness: "omp" } } })]);
  assert.deepEqual(
    written().agents.providers["sw2-lead-omp"]!.additionalModels,
    [{ id: "glm", label: "GLM", isDefault: true }],
    "a role on an agent its preset does not name starts on another role's preset there, not the first listed",
  );
});
