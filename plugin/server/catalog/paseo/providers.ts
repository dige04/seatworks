import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { writeConfigAtomic } from "../../core/config-file.ts";
import { type Json, isRecord, sameJson } from "../../core/json.ts";
import { daemonLog } from "../../core/logger.ts";
import { nodeBin, paseoConfigPath } from "../../core/paths.ts";
import { paseoToolsPolicy, supportsRole } from "../kit/harness-files.ts";
import type { HarnessSpec, Kit, ModelSpec, RoleSpec } from "../kit/kit.ts";
import { providerId } from "../kit/roles.ts";
import { presetOn } from "../team/role-seats.ts";
import type { Team } from "../team/team.ts";

/** Keys the kit sets on a provider only when it wants them, so one it stops wanting is taken off. */
const PROVIDER_OPTIONAL = ["command", "models", "additionalModels", "paseoTools", "description"];

function labelFor(kit: Kit, role: RoleSpec, harness: HarnessSpec): string {
  const tag = kit.prefix.replace(/[-_]+$/, "");
  const base = `${role.label} · ${harness.label}`;
  return tag ? `${base} (${tag})` : base;
}

export function seatPairs(kit: Kit): { role: RoleSpec; harness: HarnessSpec }[] {
  const pairs: { role: RoleSpec; harness: HarnessSpec }[] = [];
  for (const role of kit.roles) {
    for (const harness of Object.values(kit.harnesses))
      if (supportsRole(kit, harness, role)) pairs.push({ role, harness });
  }
  return pairs;
}

function choiceFor(team: Team, role: RoleSpec, harness: HarnessSpec): { model?: string; thinking?: string } {
  const seat = team.roles[role.role];
  if (seat && seat.harness.id === harness.id) return { model: seat.model?.id, thinking: seat.thinking };
  const { model, thinking } = presetOn(
    role,
    harness,
    Object.values(team.roles).map((entry) => entry.role),
  );
  return { model: model?.id, thinking };
}

function defaultModel(harness: HarnessSpec, choice: { model?: string }): ModelSpec[] {
  if (!choice.model) return [];
  const label = harness.models?.find((entry) => entry.id === choice.model)?.label ?? choice.model;
  return [{ id: choice.model, label, isDefault: true }];
}

function desiredProvider(kit: Kit, team: Team, role: RoleSpec, harness: HarnessSpec): Json {
  const entry: Json = {
    extends: harness.baseProvider,
    label: labelFor(kit, role, harness),
    env: { ...(harness.provider.env ?? {}), SEATWORKS_ROLE: role.role, SEATWORKS_KIT: kit.dir },
  };
  if (role.description) entry.description = role.description;
  // NODE is the daemon's own node, which runs the kit's scripts alike on every platform.
  const command = (harness.provider.command ?? []).map((part) =>
    part === "NODE" ? nodeBin() : part.replaceAll("KIT", kit.dir),
  );
  if (command.length > 0) entry.command = command;
  const models = defaultModel(harness, choiceFor(team, role, harness));
  if (models.length > 0) entry.additionalModels = models;
  const tools = paseoToolsPolicy(kit, role);
  if (tools) entry.paseoTools = tools;
  return entry;
}

function managedEnvKeys(kit: Kit): Set<string> {
  const keys = new Set<string>();
  for (const harness of Object.values(kit.harnesses)) {
    keys.add(harness.configDirEnv);
    for (const key of Object.keys(harness.provider.env ?? {})) keys.add(key);
  }
  return keys;
}

/**
 * Paseo's config with every provider the kit's seats need, as the kit and team want them now, and no profile of the
 * kit's: nothing reads one, since the Human starts a Supervisor by its provider.
 */
function reconcile(config: Json, kit: Kit, team: Team): { config: Json; changed: string[] } {
  const next = structuredClone(config);
  const providers = child(child(next, "agents"), "providers") as Record<string, Json>;
  const changed: string[] = [];
  const pairs = seatPairs(kit);
  const wanted = new Set(pairs.map((pair) => providerId(kit, pair.role.role, pair.harness.id)));
  if (kit.prefix) {
    dropStale(providers, kit.prefix, wanted, changed);
    dropProfiles(next, kit.prefix, changed);
  }
  const managed = managedEnvKeys(kit);
  for (const { role, harness } of pairs) {
    const id = providerId(kit, role.role, harness.id);
    reconcileProvider(providers, id, desiredProvider(kit, team, role, harness), managed, changed);
  }
  return { config: next, changed };
}

/** The record at `key`, made where it is missing. */
function child(parent: Json, key: string): Json {
  parent[key] ??= {};
  return parent[key] as Json;
}

/** Takes off the providers under the kit's prefix that no seat needs any more. */
function dropStale(providers: Record<string, Json>, prefix: string, wanted: Set<string>, changed: string[]): void {
  for (const id of Object.keys(providers)) {
    if (id.startsWith(prefix) && !wanted.has(id)) {
      delete providers[id];
      changed.push(`provider ${id} removed`);
    }
  }
}

function dropProfiles(config: Json, prefix: string, changed: string[]): void {
  const daemon = config.daemon;
  if (!isRecord(daemon) || !Array.isArray(daemon.agentProfiles)) return;
  daemon.agentProfiles = (daemon.agentProfiles as unknown[]).filter((entry) => {
    const id = isRecord(entry) ? entry.id : undefined;
    const ours = typeof id === "string" && id.startsWith(prefix);
    if (ours) changed.push(`profile ${id} removed`);
    return !ours;
  });
}

/** One provider as the kit wants it, keeping env the owner added; the env keys the kit manages follow the kit. */
function reconcileProvider(
  providers: Record<string, Json>,
  id: string,
  want: Json,
  managed: Set<string>,
  changed: string[],
): void {
  const have = providers[id] ?? {};
  const env = Object.entries(isRecord(have.env) ? have.env : {});
  const kept = Object.fromEntries(env.filter(([key]) => !key.startsWith("SEATWORKS_") && !managed.has(key)));
  const merged: Json = { ...have, ...want, env: { ...kept, ...(want.env as Json) } };
  for (const key of PROVIDER_OPTIONAL) if (!(key in want)) delete merged[key];
  if (sameJson(merged, have)) return;
  providers[id] = merged;
  changed.push(`provider ${id}`);
}

export function applyReconcile(kit: Kit, team: Team): string[] {
  const configPath = paseoConfigPath();
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as Json;
  const { config: next, changed } = reconcile(config, kit, team);
  // Staged and renamed: a daemon killed mid-write could not parse its own config. The mode is kept so a private config is not widened.
  if (changed.length > 0)
    writeConfigAtomic(configPath, `${JSON.stringify(next, null, 2)}\n`, statSync(configPath).mode & 0o777);
  return changed;
}

export function reloadDaemon(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("paseo", ["daemon", "reload"], { timeout: 30_000 }, (error, _stdout, stderr) => {
      if (error) daemonLog.error("paseo daemon reload failed:", stderr || error.message);
      resolve(!error);
    });
  });
}
