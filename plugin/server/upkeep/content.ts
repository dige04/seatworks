import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ContentChange } from "../../shared/upkeep-views.ts";
import type { Kit } from "../catalog/kit/kit.ts";
import { digest } from "../core/fs.ts";
import { isRecord } from "../core/json.ts";
import { keptFault, readKept, writeJson } from "../core/store.ts";

type Taken = { units: Record<string, { hash: string }> };

type Kind = ContentChange["kind"];

const takenFile = (stateDir: string) => join(stateDir, "content.json");

function kindOf(unit: string): Kind | undefined {
  if (unit.startsWith("guides/")) return "guide";
  if (unit.startsWith("records/")) return "record";
  if (unit.startsWith("prompts/")) return "prompt";
  if (unit.startsWith("skills/")) return "skill";
  return undefined;
}

const files = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile()) : [];
const dirs = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory()) : [];

/** A skill is one unit, its folder whole. */
function shippedUnits(kit: Kit): Record<string, string> {
  const content = join(kit.dir, "content");
  const units: Record<string, string> = {};
  for (const group of ["guides", "records", "prompts"])
    for (const name of files(join(content, group))) units[`${group}/${name}`] = digest([join(content, group, name)]);
  for (const set of dirs(join(content, "skills")))
    for (const name of dirs(join(content, "skills", set)))
      units[`skills/${set}/${name}`] = digest([join(content, "skills", set, name)]);
  return units;
}

const isTaken = (value: unknown): value is Taken => isRecord(value) && isRecord(value.units);

function takenOf(stateDir: string): Taken | null {
  const read = readKept<Taken | null>(takenFile(stateDir), null, isTaken);
  if ("fault" in read) throw keptFault(read.fault);
  return read.value;
}

const recorded = (units: Record<string, string>): Taken["units"] =>
  Object.fromEntries(Object.entries(units).map(([unit, hash]) => [unit, { hash }]));

/** What the kit ships differently from what the owner last took in. The first reading takes everything in as it is. */
export function contentChanges(kit: Kit, stateDir: string): ContentChange[] {
  const now = shippedUnits(kit);
  const held = takenOf(stateDir);
  if (!held) {
    writeJson(takenFile(stateDir), { units: recorded(now) });
    return [];
  }
  const changes: ContentChange[] = [];
  for (const unit of [...new Set([...Object.keys(now), ...Object.keys(held.units)])].sort()) {
    const kind = kindOf(unit);
    const before = held.units[unit];
    if (!kind || before?.hash === now[unit]) continue;
    changes.push({
      unit,
      kind,
      change: !before ? "added" : !now[unit] ? "removed" : "changed",
      kept: Boolean(kit.own && existsSync(join(kit.own, unit))),
    });
  }
  return changes;
}

/** The owner has seen these units as the kit ships them now. */
export function takeIn(kit: Kit, stateDir: string, units: string[]): void {
  const held = takenOf(stateDir) ?? { units: {} };
  const shipped = shippedUnits(kit);
  const next = { ...held.units };
  for (const unit of units) {
    if (shipped[unit]) next[unit] = { hash: shipped[unit] };
    else delete next[unit];
  }
  writeJson(takenFile(stateDir), { units: next });
}
