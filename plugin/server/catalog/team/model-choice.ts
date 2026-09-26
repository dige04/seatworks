import type { HarnessSpec, ModelSpec, RoleSpec } from "../kit/kit.ts";

/** Another role's preset for this agent, else Paseo's first: Paseo's own default cannot be read back, since the plugin sets it. */
function agentDefault(roles: RoleSpec[], harness: HarnessSpec): ModelSpec | undefined {
  const models = harness.models ?? [];
  const preset = roles
    .map((role) => role.defaults)
    .find(
      (defaults) =>
        defaults.harness === harness.id && defaults.model && models.some((entry) => entry.id === defaults.model),
    );
  return models.find((entry) => entry.id === preset?.model) ?? models[0];
}

/** The model named, listed or not, since which model a seat runs is the owner's choice; else another role's preset or Paseo's first. */
export function modelFor(harness: HarnessSpec, id: string | undefined, roles: RoleSpec[]): ModelSpec | undefined {
  if (!id) return agentDefault(roles, harness);
  return (harness.models ?? []).find((entry) => entry.id === id) ?? { id, label: id };
}

/**
 * `given` where the model offers it, else `chosen`, else the model's default; a model the catalog does not list keeps
 * `chosen`, as no options listed is not a list of none.
 */
export function thinkingFor(
  harness: HarnessSpec,
  model: ModelSpec | undefined,
  chosen: string | undefined,
  given?: string,
): string | undefined {
  const options = model?.thinkingOptions ?? [];
  if (options.length === 0)
    return model && !(harness.models ?? []).some((entry) => entry.id === model.id) ? chosen : undefined;
  const offered = (id: string | undefined) => options.some((option) => option.id === id);
  return [given, chosen].find(offered) ?? (options.find((option) => option.isDefault) ?? options[0])?.id;
}

/** What a role runs on a harness its seat is not on: its preset where the harness is its own, else that harness's default. */
export function presetOn(
  role: RoleSpec,
  harness: HarnessSpec,
  roles: RoleSpec[],
): { model?: ModelSpec; thinking?: string } {
  const preset = harness.id === role.defaults.harness ? role.defaults : undefined;
  const model = modelFor(harness, preset?.model, roles);
  return { model, thinking: thinkingFor(harness, model, preset?.thinking) };
}
