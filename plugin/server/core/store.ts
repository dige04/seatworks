import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseProblem, writeConfigAtomic } from "./config-file.ts";
import { errorText } from "./errors.ts";

/** A kept file as read once: missing, its parsed value, or why it could not be read, which is never taken for missing. */
type JsonRead = { absent: true } | { value: unknown } | { fault: string };

export function readJsonFile(path: string): JsonRead {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { absent: true };
    return { fault: `${path} is there but could not be read: ${errorText(error)}` };
  }
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    return { fault: `${path} is there but could not be read: ${parseProblem(path, error)}` };
  }
}

/**
 * A file the plugin keeps and cannot rebuild, as one read: `empty` while it is absent, and a fault when it is there but
 * unreadable or not what `holds` accepts. Its caller fails closed on a fault: nothing is written over the file.
 */
export function readKept<T>(
  path: string,
  empty: T,
  holds: (value: unknown) => value is T,
): { value: T } | { fault: string } {
  const read = readJsonFile(path);
  if ("fault" in read) return read;
  if ("absent" in read) return { value: empty };
  return holds(read.value) ? { value: read.value } : { fault: `${path} does not hold what the plugin keeps there` };
}

/** Why a kept file that cannot be read stops what would have written it. */
export function keptFault(fault: string): Error {
  return new Error(`${fault}. Nothing was written over it. Only the Human can repair it or move it aside.`);
}

/** For a file the plugin can rebuild or only reads: one that cannot be read is `fallback`. */
export function readJson<T>(path: string, fallback: T): T {
  const read = readJsonFile(path);
  return "value" in read ? (read.value as T) : fallback;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeConfigAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
