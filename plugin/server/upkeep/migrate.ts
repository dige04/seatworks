import { join } from "node:path";
import type { MigrateStep, MigrateView } from "../../shared/upkeep-views.ts";
import type { Kit } from "../catalog/kit/kit.ts";
import { stateRoot } from "../core/paths.ts";
import { readJson, writeJson } from "../core/store.ts";
import { versionOf } from "./update.ts";

export type LiveSeat = { provider: string; slug: string; createdAt?: string; name: string };

export type MigrateContext = {
  kit: Kit;
  home: string;
  live: LiveSeat[];
  now: number;
};

type Stamp = { stamp: string; since: string };

const stampFile = (homeDir: string) => join(stateRoot(homeDir), "kit.json");

/** Which version this machine runs, and since when: a seat started earlier runs an older one. */
export function stampKit(kit: Kit, homeDir: string, now = Date.now()): Stamp {
  const stamp = versionOf(kit.dir);
  const held = readJson<Partial<Stamp>>(stampFile(homeDir), {});
  if (held.stamp === stamp && typeof held.since === "string") return { stamp, since: held.since };
  const next = { stamp, since: new Date(now).toISOString() };
  writeJson(stampFile(homeDir), next);
  return next;
}

function seatSteps(ctx: MigrateContext, since: string): MigrateStep[] {
  const old = ctx.live.filter(
    (seat) => seat.provider.startsWith(ctx.kit.prefix) && seat.createdAt && seat.createdAt < since,
  );
  const bySlug = new Map<string, LiveSeat[]>();
  for (const seat of old) bySlug.set(seat.slug, [...(bySlug.get(seat.slug) ?? []), seat]);
  return [...bySlug].map(([slug, seats]) => ({
    kind: "seat" as const,
    where: slug,
    what: `${seats.length} seat${seats.length === 1 ? "" : "s"} started before this version`,
    detail: [
      ...seats.map((seat) => seat.name),
      "They keep the old prompts and tools until they are started again. Let each finish its work; the next seat started runs this version.",
    ],
  }));
}

export function migrationPlan(ctx: MigrateContext): MigrateView {
  const stamp = stampKit(ctx.kit, ctx.home, ctx.now);
  return { ...stamp, steps: seatSteps(ctx, stamp.since) };
}
