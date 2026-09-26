import type { Layer, RoleChoice } from "../../../shared/settings.ts";

/**
 * A setup draft over what a project's layer holds: a role the draft moves to another agent loses the choices made for
 * the old one but keeps its rules, the owner's writing; everything the draft does not name stays as it was.
 */
export function foldDraft(held: Layer, draft: Layer, harnessNow: (role: string) => string | undefined): Layer {
  const named = Object.entries(draft.roles ?? {});
  if (named.length === 0) return held;
  const roles: Record<string, RoleChoice> = { ...held.roles };
  for (const [role, choice] of named) {
    const current = roles[role] ?? {};
    const moved = Boolean(choice.harness) && choice.harness !== harnessNow(role);
    roles[role] = { ...(moved ? (current.rules ? { rules: current.rules } : {}) : current), ...choice };
  }
  return { ...held, roles };
}
