import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type MigrateContext, migrationPlan, stampKit } from "../../server/upkeep/migrate.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const NOW = Date.parse("2026-09-22T07:12:30Z");

function world(): MigrateContext {
  return { kit: makeKit(), home: tempDir("sw2-home-"), live: [], now: NOW };
}

test("migrate names the seats started before this kit was loaded, and changes nothing about them", () => {
  const ctx = world();
  const { since } = stampKit(ctx.kit, ctx.home, NOW);
  writeFileSync(join(ctx.kit.dir, "content", "prompts", "LEAD.md"), "A new brief.");
  const next = stampKit(ctx.kit, ctx.home, NOW + 60_000);
  assert.ok(next.since > since, "the kit stamp moves with its content");
  ctx.live.push(
    {
      provider: "sw2-lead-claude",
      slug: "shop-abc123",
      createdAt: new Date(NOW).toISOString(),
      name: "Lead · Claude Code",
    },
    {
      provider: "sw2-peer-omp",
      slug: "shop-abc123",
      createdAt: new Date(NOW + 120_000).toISOString(),
      name: "Peer · Oh My Pi",
    },
  );
  const plan = migrationPlan(ctx);
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.detail.slice(0, -1)]),
    [["seat", ["Lead · Claude Code"]]],
  );
});
