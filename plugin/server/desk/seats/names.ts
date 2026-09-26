import type { RoleSpec } from "../../catalog/kit/kit.ts";

/**
 * What Paseo shows a seat as: a plugin cannot rename an agent, and a seat has one duty for life, so the name it starts
 * with says that duty.
 */
export const seatTitle = {
  of: (work: { id: string; title: string }, role: Pick<RoleSpec, "label">) =>
    `${work.id} · ${role.label} · ${work.title}`,
  review: (review: string, of: string) => `${review} · Review ${of}`,
};
