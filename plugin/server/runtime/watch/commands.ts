import { isAbsolute, relative } from "node:path";
import { oneLine, within } from "../../core/text.ts";
import { type Fact, fact } from "../../domain/incident.ts";
import { type Rules, str } from "./facts.ts";
import type { Call } from "./window.ts";

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

/** What removes files, as each shell names it; cmd's flags start with a slash. */
const REMOVES = new Set(["rm", "remove-item", "rmdir", "rd"]);

const targetsOf = (words: string[]) =>
  words.slice(1).filter((word) => !word.startsWith("-") && !/^\/[a-z]$/i.test(word));

function madeBy(parts: string[]): { variables: Set<string>; paths: string[] } {
  const variables = new Set([...parts.join("\n").matchAll(MKTEMP)].map((match) => match[1]!));
  const paths = parts.flatMap((part) => {
    const words = shellWords(part);
    return words[0] === "mkdir" || words[0] === "touch" ? targetsOf(words) : [];
  });
  return { variables, paths };
}

/** Where a relative path points: where the seat runs, in scratch space, or nowhere the watch can tell. */
type At = "start" | "scratch" | "elsewhere";

const inside = (path: string) => !/^(?:[/\\~$%`]|[A-Za-z]:)/.test(path) && !CLIMBS.test(path);

/** Git's own folder, which a copy the desk made needs to stay one. */
const GIT = /^(?:\.\/)?\.git(?:[/\\]|$)/;

/** Whether a path is scratch space: what the catalog names so, the machine's temporary directory, or what the same command made. */
function scratchIn(made: ReturnType<typeof madeBy>, { scratch: named, temp }: Rules) {
  const scratch = (target: string): boolean => {
    if (CLIMBS.test(target)) return false;
    const folder = DIRNAME.exec(target)?.[1];
    if (folder !== undefined) return shellWords(folder).length === 1 && scratch(shellWords(folder)[0]!);
    return (
      named.test(target) ||
      Boolean(temp && isAbsolute(target) && !relative(temp, target).startsWith("..")) ||
      made.variables.has(VARIABLE.exec(target)?.[1] ?? "") ||
      made.paths.some((path) => target === path || target.startsWith(`${path.replace(/\/$/, "")}/`))
    );
  };
  return scratch;
}

export function onDetail(call: Call, rules: Rules): Fact[] {
  if (call.detail.type !== "shell") return [];
  // A command at a time: removing a commit message's temp file once paged a Lead.
  const pieces = str(call.detail.command).split(/(&&|\|\||;|\n)/);
  const parts = pieces.filter((_, index) => index % 2 === 0);
  const scratch = scratchIn(madeBy(parts), rules);
  let at: At = "start";
  const found: Fact[] = [];
  for (const [index, part] of parts.entries()) {
    const words = shellWords(part);
    if (words[0] === "cd" || words[0] === "pushd" || words[0] === "popd") {
      const target = targetsOf(words)[0];
      const to: At = target && scratch(target) ? "scratch" : target && inside(target) ? at : "elsewhere";
      // Only `&&` says the cd took: after any other separator the next part may run where the seat was.
      at = pieces[2 * index + 1] === "&&" || to === at ? to : "elsewhere";
      continue;
    }
    if (touchesSecret(words, part, rules)) found.push(fact("secret", around(oneLine(part, Infinity), undefined, 200)));
    const targets = targetsOf(words);
    // In a copy the desk made for this seat alone, what it removes there is its own; throwing work away with git still pages.
    const removesOwn =
      REMOVES.has(words[0]?.toLowerCase() ?? "") &&
      targets.length > 0 &&
      targets.every(
        (target) =>
          scratch(target) ||
          (inside(target) && (at === "scratch" || (at === "start" && rules.ownCopy === true && !GIT.test(target)))),
      );
    if (rules.destructive.test(part) && !removesOwn && !found.some((seen) => seen.kind === "destructive"))
      found.push(fact("destructive", around(oneLine(part, Infinity), rules.destructive, 200)));
  }
  return found;
}

/** A command that reads, prints, dumps or stages a secret: a secret path among what it reads, or a command that shows secrets. */
function touchesSecret(words: string[], part: string, rules: Rules): boolean {
  const command = words[0]?.toLowerCase() ?? "";
  if (command === "rm" || command === "remove-item") return false;
  // What cp and mv write to is not read.
  const read = command === "cp" || command === "mv" ? words.slice(1, -1) : words.slice(1);
  return rules.secretCommand.test(part.trim()) || read.some((word) => rules.secretPath.test(word));
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
