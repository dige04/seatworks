import { join } from "node:path";
import { sameJson } from "../../core/json.ts";
import { readJson, writeJson } from "../../core/store.ts";
import { errorText } from "../../core/errors.ts";
import type { ModelList } from "../../core/ports.ts";
import type { Kit, ModelSpec } from "../kit/kit.ts";
import { seatPairs } from "./providers.ts";

export type ModelCache = Record<string, { at: string; models: ModelSpec[]; error: string | null }>;

const cacheFile = (stateDir: string) => join(stateDir, "models.json");

export function readModels(stateDir: string): ModelCache {
  return readJson<ModelCache>(cacheFile(stateDir), {});
}

/** A harness Paseo listed nothing for keeps what it had: an empty answer is not a list. */
export function applyModels(kit: Kit, cache: ModelCache): void {
  for (const harness of Object.values(kit.harnesses)) {
    const models = cache[harness.id]?.models;
    if (models?.length) harness.models = models;
  }
}

/** A model's own default is dropped: Paseo marks the one this plugin told it to, so it is our choice read back. */
function specOf(model: NonNullable<ModelList["models"]>[number]): ModelSpec {
  const spec: ModelSpec = { id: model.id, label: model.label };
  if (model.thinkingOptions?.length)
    spec.thinkingOptions = model.thinkingOptions.map((option) => ({
      id: option.id,
      label: option.label,
      ...(option.id === model.defaultThinkingOptionId ? { isDefault: true } : {}),
    }));
  return spec;
}

/** Each agent a role can sit on, by the built-in provider Paseo lists its models under, so listing needs none of the kit's. */
export function listingProviders(kit: Kit): Map<string, string> {
  return new Map(seatPairs(kit).map(({ harness }) => [harness.id, harness.baseProvider]));
}

export async function fetchModels(
  kit: Kit,
  list: (provider: string) => Promise<ModelList>,
  stateDir: string,
  now = Date.now(),
): Promise<{ cache: ModelCache; changed: boolean }> {
  const held = readModels(stateDir);
  const next: ModelCache = {};
  const providers = [...listingProviders(kit)];
  const answers = await Promise.all(
    providers.map(([, provider]) => list(provider).catch((error): ModelList => ({ error: errorText(error) }))),
  );
  for (const [index, [harness]] of providers.entries()) {
    const before = held[harness];
    const listed = answers[index]!;
    const models = (listed.models ?? []).filter((model) => model.isSelectable !== false).map(specOf);
    const error = models.length > 0 ? null : (listed.error ?? "Paseo listed no models");
    next[harness] =
      models.length > 0 || !before ? { at: new Date(now).toISOString(), models, error } : { ...before, error };
  }
  const changed = !sameJson(strip(next), strip(held));
  writeJson(cacheFile(stateDir), next);
  return { cache: next, changed };
}

const strip = (cache: ModelCache) => Object.fromEntries(Object.entries(cache).map(([id, entry]) => [id, entry.models]));
