import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectBlock } from "../kit/content.ts";
import type { Kit } from "../kit/kit.ts";

const BEGIN = "<!-- seatworks:begin: Seatworks writes this block; write your own rules outside it -->";
const END = "<!-- seatworks:end -->";
const BLOCK = /<!-- seatworks:begin[^\n]*-->\n[^]*?<!-- seatworks:end -->\n?/;

/**
 * Puts the kit's block in the project's AGENTS.md, which every agent working there reads, or brings it up to date,
 * leaving the rest as the Human wrote it, through a link if the file is one. A kit with no block, or a root that is no
 * folder here, is left alone. Says whether the file changed.
 */
export function writeProjectBlock(kit: Kit, root: string): boolean {
  const text = projectBlock(kit);
  if (!text || !existsSync(root) || !statSync(root).isDirectory()) return false;
  const file = join(root, "AGENTS.md");
  const had = existsSync(file) ? readFileSync(file, "utf-8") : "";
  const block = `${BEGIN}\n${text.trim()}\n${END}\n`;
  const next = BLOCK.test(had) ? had.replace(BLOCK, block) : had.trim() ? `${had.trimEnd()}\n\n${block}` : block;
  if (next === had) return false;
  writeFileSync(file, next);
  return true;
}
