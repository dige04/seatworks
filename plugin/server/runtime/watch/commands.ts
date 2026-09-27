import { isAbsolute, relative } from "node:path";
import { oneLine, within } from "../../core/text.ts";
import { type Fact, fact } from "../../domain/incident.ts";
import { type Rules, str } from "./facts.ts";
import type { Call } from "./window.ts";

const SCRATCH = /^(?:\$\{?TMPDIR\}?|\/tmp|\/private\/tmp)(?:\/|$)/;
const MKTEMP = /\b([A-Za-z_]\w*)=["']?(?:\$\(\s*mktemp\b[^)]*\)|`\s*mktemp\b[^`]*`)/g;
const VARIABLE = /^\$\{?([A-Za-z_]\w*)\}?(?:\/|$)/;
const DIRNAME = /^\$\(\s*dirname\s+([^)]*)\)$/;
const CLIMBS = /(?:^|[/\\])\.\.(?:[/\\]|$)/;

/** The end of the `$(…)` that opens at `start`, counting the parentheses nested in it. */
function closing(line: string, start: number): number {
  let depth = 0;
  for (let at = start; at < line.length; at++) {
    if (line[at] === "(") depth += 1;
    else if (line[at] === ")" && --depth === 0) return at;
  }
  return line.length - 1;
}

/**
 * A command's words as the shell passes them: quotes and escapes gone, `"$TMPDIR"/x` one word, and a `$(…)` kept whole
 * with its own quotes. A backslash escapes only what the shell would read otherwise, so a Windows path keeps its own.
 */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let word: string | undefined;
  let quote: string | undefined;
  for (let at = 0; at < line.length; at++) {
    const char = line[at]!;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
    } else if (char === "$" && line[at + 1] === "(") {
      const end = closing(line, at + 1);
      word = (word ?? "") + line.slice(at, end + 1);
      at = end;
    } else if (char === "\\" && /[\s"'$`\\]/.test(line[at + 1] ?? "")) {
      word = (word ?? "") + line[++at];
    } else if (char === '"' || (char === "'" && !quote)) {
      quote = quote === char ? undefined : char;
      word ??= "";
    } else if (!quote && /\s/.test(char)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else word = (word ?? "") + char;
  }
  if (word !== undefined) words.push(word);
  return words;
}

const targetsOf = (words: string[]) => words.slice(1).filter((word) => !word.startsWith("-"));

function madeBy(parts: string[]): { variables: Set<string>; paths: string[] } {
  const variables = new Set([...parts.join("\n").matchAll(MKTEMP)].map((match) => match[1]!));
  const paths = parts.flatMap((part) => {
    const words = shellWords(part);
    return words[0] === "mkdir" || words[0] === "touch" ? targetsOf(words) : [];
  });
  return { variables, paths };
}

/** An `rm` whose every target is scratch space: $TMPDIR, /tmp, the machine's temporary directory, or what the same command made. */
function scratchOnly(part: string, made: ReturnType<typeof madeBy>, temp?: string): boolean {
  const words = shellWords(part);
  if (words[0] !== "rm") return false;
  const targets = targetsOf(words);
  const scratch = (target: string): boolean => {
    if (CLIMBS.test(target)) return false;
    const folder = DIRNAME.exec(target)?.[1];
    if (folder !== undefined) return shellWords(folder).length === 1 && scratch(shellWords(folder)[0]!);
    return (
      SCRATCH.test(target) ||
      Boolean(temp && isAbsolute(target) && !relative(temp, target).startsWith("..")) ||
      made.variables.has(VARIABLE.exec(target)?.[1] ?? "") ||
      made.paths.some((path) => target === path || target.startsWith(`${path.replace(/\/$/, "")}/`))
    );
  };
  return targets.length > 0 && targets.every(scratch);
}

export function onDetail(call: Call, rules: Rules): Fact[] {
  if (call.detail.type !== "shell") return [];
  // A command at a time: removing a commit message's temp file once paged a Lead.
  const parts = str(call.detail.command).split(/&&|\|\||;|\n/);
  const made = madeBy(parts);
  const risky = parts.find((part) => rules.destructive.test(part) && !scratchOnly(part, made, rules.temp));
  return risky ? [fact("destructive", around(oneLine(risky, Infinity), rules.destructive, 200))] : [];
}

/** Cuts around the match, not from the front: what makes a long command irreversible is often at its end. */
function around(text: string, pattern: RegExp | undefined, limit: number): string {
  if (text.length <= limit) return text;
  const found = pattern ? new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(text) : null;
  const start =
    found && found.index + found[0].length > limit
      ? Math.max(0, Math.min(found.index - Math.floor(limit / 4), text.length - limit))
      : 0;
  const body = within(text.slice(start).replace(/^[\uDC00-\uDFFF]/, ""), limit);
  return `${start > 0 ? "…" : ""}${body}${start + body.length < text.length ? "…" : ""}`;
}
