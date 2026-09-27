import type { Source } from "../../model/layer.ts";

/** Where a setting's value comes from, as a row's hint says it; `follows` is the role a role follows while unset. */
export function sourceLabel(source: Source, layer: "machine" | "project", follows?: string): string {
  if (source === "here") return layer === "machine" ? "Set here" : "Set for this project";
  if (source === "machine") return "From this machine";
  return follows ? `Not set · follows the ${follows}` : "Catalog default";
}
