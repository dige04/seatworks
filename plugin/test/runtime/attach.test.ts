// First, so this file has a HOME of its own even run alone: what it writes under HOME would otherwise land in the owner's.
import "../setup.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { stateRoot } from "../../server/core/paths.ts";
import { contracts } from "../../shared/rpc.ts";
import { tempDir } from "../tempdir.ts";
import { fakeConfig } from "./fake-paseo.ts";
import { daemon, served, which } from "./served.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf-8" });

test("a project attached by path, set up, detached only when idle and attached again, and the setup screen's candidates and folders", async (t) => {
  const { call } = served();
  const listed = async () => (await call(contracts.projects, {})).map((entry) => entry.slug);
  const root = realpathSync(tempDir("sw2-rpc-attach-"));
  git(root, "init", "-q");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "Use pnpm.\n");
  const added = which(await call(contracts.projectsAdd, { root: join(root, "src") }), "slug");
  const agents = () => readFileSync(join(root, "AGENTS.md"), "utf-8");
  assert.equal(
    agents(),
    "Use pnpm.\n\n<!-- seatworks:begin: Seatworks writes this block; write your own rules outside it -->\n## Seatworks\n\nWork through the team tools.\n<!-- seatworks:end -->\n",
    "setting a project up puts the Seatworks block in its AGENTS.md, which every agent there reads, after the Human's own",
  );
  assert.equal(
    added.root,
    root,
    "a path inside the project registers the project root, before any agent has run in it",
  );
  assert.ok((await listed()).includes(added.slug));
  const read = which(await call(contracts.settingsRead, { project: added.slug }), "values");
  const values = {
    rules: "Never touch the release branch.",
    roles: { peer: { harness: "omp" } },
    mcp: {
      docs: {
        enabled: true,
        connect: { type: "http" as const, url: "https://x", headers: { Authorization: "Bearer SECRET" } },
      },
    },
  };
  const saved = await call(contracts.settingsWrite, { project: added.slug, revision: read.revision, values });
  assert.equal(saved.status, "saved", JSON.stringify(saved));
  assert.equal(
    which(await call(contracts.team, { project: added.slug }), "roles").roles.peer!.harness,
    "omp",
    "its own settings",
  );
  const missing = await call(contracts.projectsAdd, { root: join(root, "nowhere") });
  assert.match(which(missing, "error").error, /is not a directory/);

  const written = agents();
  const again = which(await call(contracts.projectsAdd, { root }), "slug");
  assert.equal(agents(), written, "and setting it up again writes it once");
  assert.equal(again.slug, added.slug, "the same repository is the same project");
  const kept = which(await call(contracts.settingsRead, { project: added.slug }), "values").values;
  assert.deepEqual(
    [kept.rules, kept.mcp!.docs!.connect!.headers!.Authorization],
    ["Never touch the release branch.", "Bearer SECRET"],
    "a second setup leaves the desk's layer alone",
  );

  const ledger = join(stateRoot(), "projects", added.slug, "ledger.json");
  const remove = async () => call(contracts.projectsRemove, { project: added.slug });
  writeFileSync(ledger, JSON.stringify({ lanes: { L1: { id: "L1", status: "open" } }, tasks: {} }));
  assert.match(
    which(await remove(), "error").error,
    /1 open or waiting lane\(s\)/,
    "not detached while work runs in it",
  );
  writeFileSync(ledger, JSON.stringify({ lanes: { L1: { id: "L1", status: "waiting", after: ["L0"] } }, tasks: {} }));
  assert.match(
    which(await remove(), "error").error,
    /1 open or waiting lane\(s\)/,
    "a lane waiting to open is work to come",
  );
  // Closed lanes and their cut tasks are provenance that nothing deletes, so they must not count as work.
  const closed = {
    lanes: { L1: { id: "L1", status: "closed" } },
    tasks: { "L1-T1": { id: "L1-T1", lane: "L1", status: "cut" } },
  };
  writeFileSync(ledger, JSON.stringify(closed));
  assert.deepEqual(await remove(), { removed: added.slug });
  assert.equal((await listed()).includes(added.slug), false);
  assert.match(which(await remove(), "error").error, /has been seen/);
  const back = which(await call(contracts.projectsAdd, { root }), "slug");
  assert.equal(back.slug, added.slug);
  assert.ok((await listed()).includes(added.slug), "an attach that reports a slug is one the rest of the plugin finds");
  assert.equal((await call(contracts.settingsRead, { project: added.slug })).status, "ready");

  const repo = realpathSync(tempDir("sw2-rpc-live-"));
  git(repo, "init", "-q");
  git(repo, "commit", "-q", "--allow-empty", "-m", "init");
  const linked = join(realpathSync(tempDir("sw2-rpc-linked-")), "wt");
  git(repo, "worktree", "add", "-q", "-b", "side", linked);
  const plain = realpathSync(tempDir("sw2-rpc-plain-"));
  const ours = join(stateRoot(), "worktrees/shop-ef484b/S0");
  mkdirSync(ours, { recursive: true });
  const roots = [repo, linked, plain, ours, join(repo, "nowhere"), root];
  assert.deepEqual(
    await call(contracts.projectsCandidates, { roots }),
    [repo],
    "a setup screen is offered no worktree, gone or plain directory, nor a project already set up",
  );

  const walk = realpathSync(tempDir("sw2-rpc-browse-"));
  mkdirSync(join(walk, "plain"), { recursive: true });
  git(walk, "init", "-q", "repo");
  const folders = which(await call(contracts.paths, { path: walk }), "folders");
  assert.equal(folders.path, walk);
  assert.equal(typeof folders.parent, "string", "a folder that is not the root offers the way up");
  assert.deepEqual(
    folders.folders.map((folder) => [folder.name, folder.repository]).sort(),
    [
      ["plain", false],
      ["repo", true],
    ],
    "a repository is marked as one",
  );
  assert.equal(which(await call(contracts.paths, { path: join(walk, "repo") }), "folders").repository, true);
  assert.match(
    which(await call(contracts.paths, { path: join(walk, "nowhere") }), "error").error,
    /is not a directory/,
  );
  const locked = join(walk, "locked");
  mkdirSync(locked);
  chmodSync(locked, 0o000);
  t.after(() => chmodSync(locked, 0o700));
  const refused = await call(contracts.paths, { path: locked });
  assert.match(
    which(refused, "error").error,
    /could not be read/,
    "a folder that cannot be read is a refusal, not a rejection",
  );
});

test("Paseo holds a provider for each role and agent an attached project's team seats: none at load with no project attached, set up on attach, following each settings save, and taken off on detach, though never from under a live seat", async () => {
  const config = fakeConfig({
    providers: { claude: { env: { TOKEN: "keep" } }, "sw2-peer-codex": { extends: "codex", label: "x" } },
    agentProfiles: [{ id: "sw2-lead-claude", provider: "sw2-lead-claude" }],
  });
  const live: { provider: string }[] = [];
  const { call, runtime, providers } = served(daemon(config, live));
  const loaded = runtime.prepare();
  await call(contracts.projects, {});
  await loaded;
  assert.deepEqual(
    await providers(),
    {},
    "a load with no project attached leaves no provider of the kit's, once a panel call brings Paseo's API",
  );
  const root = realpathSync(tempDir("sw2-rpc-providers-"));
  git(root, "init", "-q");
  const added = which(await call(contracts.projectsAdd, { root }), "slug");
  assert.deepEqual(
    Object.keys(await providers()).sort(),
    ["sw2-lead-claude", "sw2-peer-omp", "sw2-scribe-omp", "sw2-supervisor-claude"],
    "attaching sets up exactly what the project's team seats, so its Supervisor can be started at once",
  );
  const own = which(await call(contracts.settingsRead, { project: added.slug }), "values");
  const values = { roles: { lead: { harness: "omp" } } };
  const ownSaved = await call(contracts.settingsWrite, { project: added.slug, revision: own.revision, values });
  assert.equal(ownSaved.status, "saved", JSON.stringify(ownSaved));
  assert.deepEqual(
    Object.keys(await providers()).sort(),
    ["sw2-lead-omp", "sw2-peer-omp", "sw2-scribe-omp", "sw2-supervisor-claude"],
    "a project's own save moves its seats",
  );
  const machine = which(await call(contracts.settingsRead, {}), "values");
  live.push({ provider: "sw2-lead-omp/glm" });
  const haiku = { roles: { supervisor: { model: "haiku" } } };
  assert.equal((await call(contracts.settingsWrite, { revision: machine.revision, values: haiku })).status, "saved");
  assert.deepEqual(
    (await providers())["sw2-supervisor-claude"]?.additionalModels?.map((model) => model.id),
    ["haiku"],
    "and so does the machine's",
  );
  const back = which(await call(contracts.settingsRead, { project: added.slug }), "values");
  await call(contracts.settingsWrite, { project: added.slug, revision: back.revision, values: {} });
  assert.ok("sw2-lead-omp" in (await providers()), "a Lead still working on its agent keeps its provider");
  live.splice(0);
  assert.deepEqual(await call(contracts.projectsRemove, { project: added.slug }), { removed: added.slug });
  assert.deepEqual(await providers(), {}, "detached, its seats' providers go with it, and one no seat runs on");
  const { config: held } = await config.api.get();
  assert.deepEqual(
    [held.providers.claude, held.agentProfiles],
    [{ env: { TOKEN: "keep" } }, []],
    "the owner's own stay",
  );
  assert.equal(
    config.patches.some(
      (patch) => "providers" in patch && Object.keys(patch.providers!).some((id) => !id.startsWith("sw2-")),
    ),
    false,
    "and no patch touches them",
  );
});
