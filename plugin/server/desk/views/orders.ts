import { readFileSync, statSync } from "node:fs";
import type { Kit } from "../../catalog/kit/kit.ts";
import type { OrdersView } from "../../../shared/views.ts";
import { type Project, conceptFile, readProjectConfig } from "../project/project.ts";

const SHOWN = 4000;

/**
 * What the Human settled for a project, for them to read: their standing orders, and its concept as the Supervisor wrote it
 * down. Orders that cannot be read show as the fault alone, never as defaults the Human did not set.
 */
export function ordersView(kit: Kit, project: Project, now = Date.now()): OrdersView {
  const read = readProjectConfig(project.state);
  const config = "config" in read ? read.config : undefined;
  const file = conceptFile(project.state);
  const text = file ? readFileSync(file, "utf-8") : "";
  return {
    fault: "fault" in read ? read.fault : null,
    askFirst: config?.askFirst ?? [],
    riskRules: config
      ? (config.riskRules ?? kit.ecosystem.riskRules).map(({ paths, invariant, reviewQuestion, rehearse }) => ({
          paths,
          invariant,
          reviewQuestion,
          rehearse: rehearse ?? null,
        }))
      : [],
    ownRules: config?.riskRules !== undefined,
    laneHome: config?.laneHome ?? null,
    concept: file
      ? {
          text: text.slice(0, SHOWN),
          minutes: Math.max(0, Math.round((now - statSync(file).mtimeMs) / 60_000)),
          more: text.length > SHOWN,
        }
      : null,
  };
}
