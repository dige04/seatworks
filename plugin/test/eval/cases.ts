import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rules } from "../../server/runtime/watch/facts.ts";

/** The watch's eval set, in test/fixtures/watch-eval: code-fact cases the suite runs, pattern cases a model is asked. */
type Step =
  | { shell: string; exit?: number; refused?: true }
  | { edit: string }
  | { think: string }
  | { say: string }
  | { compact: true };

/** One case of the code-fact eval set: what the seat did, and whether `fact` should be raised of it. */
export type FactCase = {
  fact: string;
  expect: boolean;
  source: string;
  known?: string;
  rules?: Partial<Rules> & { scope?: string[] };
  command?: string;
  read?: string;
  edit?: { filePath: string; oldString: string; newString: string };
  steps?: Step[];
  handback?: { outcome: string; summary: string };
};

const EVAL = join(import.meta.dirname, "..", "fixtures", "watch-eval");

export const factCases = (): FactCase[] =>
  (JSON.parse(readFileSync(join(EVAL, "facts.json"), "utf-8")) as { cases: FactCase[] }).cases;

/** One case of the pattern eval set: a text of one kind, and whether the pattern's question should hold of it. */
export type PatternCase = {
  pattern: string;
  expect: boolean;
  item: "thought" | "said" | "call";
  text: string;
  source: string;
  rule?: string;
};

export const patternCases = (): PatternCase[] =>
  (JSON.parse(readFileSync(join(EVAL, "patterns.json"), "utf-8")) as { cases: PatternCase[] }).cases;
