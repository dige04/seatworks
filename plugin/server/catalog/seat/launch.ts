import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { writeConfigAtomic } from "../../core/config-file.ts";
import { executableIn, nodeBin, pathDirs, stateRoot } from "../../core/paths.ts";
import type { AgentConfig, SessionOpen } from "../../core/ports.ts";
import { type Json, layered, setPath } from "../../core/json.ts";
import {
  type HarnessSpec,
  type Kit,
  type McpServers,
  type ModelSpec,
  PASEO_SERVER,
  type RoleSpec,
} from "../kit/kit.ts";
import { agentDefault, seatOf } from "../kit/roles.ts";
import type { Team } from "../team/team.ts";
import { preapprovedFor } from "./servers.ts";

type RenderPrompt = (role: RoleSpec) => string;

/** Only what the role declares it writes: state also holds the desk's record, whose `gate` runs unsandboxed in the daemon. */
export function stateWrites(role: RoleSpec, state: string): string[] {
  return (role.writes ?? []).map((entry) => join(state, entry.replace(/\/$/, "")));
}

/** A seat's launch config as its role and the team make it: model, thinking, prompt, MCP servers and provider options. */
export function applyRole(
  kit: Kit,
  team: Team,
  config: AgentConfig,
  render: RenderPrompt,
  state?: string,
  servers: McpServers = {},
): AgentConfig {
  const seat = seatOf(kit, config.provider);
  if (!seat) return config;
  const { role, harness } = seat;
  const next: AgentConfig = { ...config };
  const { model, preferred } = modelOf(kit, team, config, role, harness);
  if (model) next.model = model.id;
  if (harness.provider.profileModeId) next.modeId = harness.provider.profileModeId;
  const thinking = thinkingOf(config.thinkingOptionId, model, preferred);
  if (thinking !== undefined) next.thinkingOptionId = thinking;
  else delete next.thinkingOptionId;
  const prompt = render(role);
  next.systemPrompt = config.systemPrompt ? `${prompt}\n\n${config.systemPrompt}` : prompt;
  if (harness.mcp.delivery === "launch" && Object.keys(servers).length > 0) {
    next.mcpServers = { ...(config.mcpServers ?? {}), ...servers };
    if (harness.mcp.preapprove) {
      const preapproved = preapprovedFor(kit, team, role.role);
      next.toolPolicy = {
        preapproved: preapproved.filter((ref) => ref.server in servers || ref.server === PASEO_SERVER),
      };
    }
  }
  const providerOptions = providerOptionsOf(harness, role, config, state);
  if (providerOptions !== config.providerOptions) next.providerOptions = providerOptions;
  return next;
}

/** Paseo's model where the catalog lists it, else the team's for the role on this harness, else the agent's default; and the thinking the team chose for that model. */
function modelOf(
  kit: Kit,
  team: Team,
  config: AgentConfig,
  role: RoleSpec,
  harness: HarnessSpec,
): { model?: ModelSpec; preferred?: string } {
  const chosen = team.roles[role.role];
  const own = chosen?.harness.id === harness.id ? chosen : undefined;
  const listed = (harness.models ?? []).find((entry) => entry.id === config.model);
  const model = listed ?? own?.model ?? agentDefault(kit.roles, harness);
  return { model, preferred: own && own.model?.id === model?.id ? own.thinking : undefined };
}

/** Paseo's thinking where the model offers it, else the team's, else the model's default; with no options offered, only the team's. */
function thinkingOf(
  given: string | undefined,
  model: ModelSpec | undefined,
  preferred: string | undefined,
): string | undefined {
  const options = model?.thinkingOptions ?? [];
  if (options.length === 0) return preferred || undefined;
  const valid = (id: string | undefined) => Boolean(id) && options.some((option) => option.id === id);
  return [given, preferred].find(valid) ?? (options.find((option) => option.isDefault) ?? options[0])!.id;
}

/** The paths the role writes under the state, and the project as its context, where the harness takes them at launch. */
function providerOptionsOf(
  harness: HarnessSpec,
  role: RoleSpec,
  config: AgentConfig,
  state: string | undefined,
): Json | undefined {
  let options = config.providerOptions;
  if (harness.stateWrites?.delivery === "launch" && state)
    for (const path of stateWrites(role, state)) options = appendAt(options, harness.stateWrites.path, path);
  if (harness.projectContextOption && config.cwd) options = appendAt(options, harness.projectContextOption, config.cwd);
  return options;
}

/** `options` with `value` added to the list at the dot path `path`, the records on the way copied rather than changed. */
function appendAt(options: Json | undefined, path: string, value: string): Json {
  const added: Json = {};
  setPath(added, path.split("."), [value]);
  return layered(options, added) as Json;
}

/**
 * What a seat's rules file takes in of the project's own instructions: each of `imports` the project has, unless a file
 * its agent reads there already takes it in, since Seatworks keeps its block in the project's AGENTS.md and Claude reads
 * that only where the project has no CLAUDE.md.
 */
export function projectImports(harness: HarnessSpec, root: string | undefined): string {
  const spec = harness.projectInstructions;
  if (!spec || !root) return "";
  const read = spec.reads
    .filter((file) => existsSync(join(root, file)))
    .map((file) => readFileSync(join(root, file), "utf-8"))
    .join("\n");
  return spec.imports
    .filter((file) => existsSync(join(root, file)) && !new RegExp(`@(\\./)?${escaped(file)}\\b`).test(read))
    .map((file) => `${spec.importAs.replace("{path}", join(root, file))}\n`)
    .join("");
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The harness's own env goes in too: Paseo may run one agent server for every seat of a harness, built from its built-in provider.
 * `shim` is the directory `seatBin` writes, which goes first on the seat's PATH. TMPDIR is where every seat is told its
 * scratch files go, so it is always set: the system's, which is the daemon's own where it has one, as Linux services and
 * Windows often do not.
 */
export function seatEnv(
  kit: Kit,
  request: SessionOpen,
  seatPath: string,
  project: { root: string; state: string },
  shim?: string,
): SessionOpen {
  const seat = seatOf(kit, request.provider);
  if (!seat) return request;
  return {
    ...request,
    env: {
      ...request.env,
      ...seat.harness.provider.env,
      [seat.harness.configDirEnv]: seatPath,
      ...(seat.harness.settings.overlayEnv
        ? { [seat.harness.settings.overlayEnv]: join(seatPath, seat.harness.settings.file) }
        : {}),
      TMPDIR: request.env.TMPDIR ?? tmpdir(),
      SEATWORKS_ROLE: seat.role.role,
      SEATWORKS_KIT: kit.dir,
      SEATWORKS_PROJECT: project.root,
      SEATWORKS_STATE: project.state,
      ...(shim ? { PATH: [shim, request.env.PATH ?? process.env.PATH].filter(Boolean).join(delimiter) } : {}),
    },
  };
}

const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
/** `text` as a batch file's `echo` prints it: cmd's own characters escaped, and `%` doubled. */
const echoed = (text: string) => text.replace(/[\^&|<>()]/g, "^$&").replaceAll("%", "%%");

/** The git a seat's PATH finds past the shim: the shim's directory is skipped, since what is there is named git too. */
function realGit(skip: string): string | undefined {
  return executableIn(
    pathDirs().filter((dir) => dir && dir !== skip),
    "git",
  );
}

/**
 * Writes the directory a seat's PATH starts at, and gives it: a git that runs the kit's git shim with node, the shim and the real
 * git by absolute path, and for each command the kit refuses one that says why and fails. Nothing where this machine has no git.
 */
export function seatBin(kit: Kit, root = stateRoot()): string | undefined {
  const dir = join(root, "bin");
  const git = realGit(dir);
  if (!git) return undefined;
  const [node, shim] = [nodeBin(), join(kit.dir, "bin", "git-shim.mjs")];
  const commands: Record<string, { sh: string; cmd: string }> = {
    git: {
      sh: `#!/bin/sh\nexec ${quoted(node)} ${quoted(shim)} ${quoted(git)} "$@"\n`,
      cmd: `@echo off\r\n"${node}" "${shim}" "${git}" %*\r\n`,
    },
  };
  for (const [name, why] of Object.entries(kit.refused)) {
    const said = `${name}: refused: ${why}. Say what you need to whoever gave you the work.`;
    commands[name] = {
      sh: `#!/bin/sh\necho ${quoted(said)} >&2\nexit 1\n`,
      cmd: `@echo off\r\n>&2 echo ${echoed(said)}\r\nexit /b 1\r\n`,
    };
  }
  // Windows shells find the batch file; the Git Bash some agents run commands in finds the script.
  const wanted = Object.fromEntries(
    Object.entries(commands).flatMap(([name, { sh, cmd }]) =>
      process.platform === "win32"
        ? [
            [name, sh],
            [`${name}.cmd`, cmd],
          ]
        : [[name, sh]],
    ),
  );
  mkdirSync(dir, { recursive: true });
  // The directory is the plugin's alone: a command the kit no longer refuses must run again.
  for (const name of readdirSync(dir)) if (!(name in wanted)) rmSync(join(dir, name), { force: true });
  for (const [name, text] of Object.entries(wanted)) {
    const file = join(dir, name);
    if (!existsSync(file) || readFileSync(file, "utf-8") !== text) writeConfigAtomic(file, text, 0o755);
  }
  return dir;
}
