import { isAbsolute, relative } from "node:path";
import { oneLine, within } from "../../core/text.ts";
import { type Fact, fact } from "../../domain/incident.ts";
import { type Rules, secretFile, str } from "./facts.ts";
import type { Call } from "./window.ts";

const MKTEMP = /\b([A-Za-z_]\w*)=["']?(?:\$\(\s*mktemp\b[^)]*\)|`\s*mktemp\b[^`]*`)/g;
const VARIABLE = /^\$\{?([A-Za-z_]\w*)\}?(?:\/|$)/;
const ASSIGN = /^(?:export\s+)?([A-Za-z_]\w*)=("[^"]*"|'[^']*'|\S+)$/g;
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

function madeBy(parts: string[]): { variables: Set<string>; paths: string[]; assigned: RegExpMatchArray[] } {
  const variables = new Set([...parts.join("\n").matchAll(MKTEMP)].map((match) => match[1]!));
  const assigned = parts.flatMap((part) => [...part.trim().matchAll(ASSIGN)]);
  const paths = parts.flatMap((part) => {
    const words = shellWords(part);
    return words[0] === "mkdir" || words[0] === "touch" ? targetsOf(words) : [];
  });
  return { variables, paths, assigned };
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
  // A variable the same command set to scratch space names scratch space wherever it is used after.
  for (const [, name, value] of made.assigned)
    if (!made.variables.has(name!) && scratch(shellWords(value!)[0] ?? "")) made.variables.add(name!);
  return scratch;
}

/** A command whose every address is on this machine, as a seat trying the server it built: nothing leaves. */
function onlyLocal(words: string[], rules: Pick<Rules, "localHost">): boolean {
  const addresses = words.filter((word) => /^[a-z]+:\/\//i.test(word) || rules.localHost.test(word));
  return addresses.length > 0 && addresses.every((word) => rules.localHost.test(word));
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
    // A function's body or a group runs its first command: `fresh(){ rm -rf "$C"` removes as `rm -rf "$C"` does.
    while (words[0] !== undefined && /^(?:[A-Za-z_][\w-]*\(\)\{?|\{|\()$/.test(words[0])) words.shift();
    if (words[0] === "cd" || words[0] === "pushd" || words[0] === "popd") {
      const target = targetsOf(words)[0];
      const to: At = target && scratch(target) ? "scratch" : target && inside(target) ? at : "elsewhere";
      // Only `&&` says the cd took: after any other separator the next part may run where the seat was.
      at = pieces[2 * index + 1] === "&&" || to === at ? to : "elsewhere";
      continue;
    }
    const quoted = around(oneLine(part, Infinity), undefined, 200);
    if (touchesSecret(words, part, rules)) found.push(fact("secret", quoted));
    if ((rules.boundary.test(part) && !onlyLocal(words, rules)) || runsOutside(words, rules, scratch))
      found.push(fact("boundary", quoted));
    if (rules.dependencyInstall.test(part)) found.push(fact("dependency", quoted));
    if (skipsHooks(words) || rules.guardCommand.test(part) || writesGuard(words, rules))
      found.push(fact("guard", quoted));
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

/** A commit or push told to skip its hooks: `--no-verify`, or a commit's `-n` in any cluster of short flags. */
function skipsHooks(words: string[]): boolean {
  if (words[0] !== "git") return false;
  const rest = words[1] === "-C" ? words.slice(3) : words.slice(1);
  const verb = rest[0];
  if (verb !== "commit" && verb !== "push") return false;
  return rest.some((word) => word === "--no-verify" || (verb === "commit" && /^-[a-zA-Z]*n[a-zA-Z]*$/.test(word)));
}

/** A command that writes, moves or removes a file that fences a seat: by a redirect, or as a program that changes files. */
function writesGuard(words: string[], rules: Rules): boolean {
  const paths = words.slice(1).map((word) => word.replace(/^>+/, ""));
  if (!paths.some((path) => rules.guardPath.test(path))) return false;
  return words.some((word) => word.startsWith(">")) || WRITERS.has(words[0]?.toLowerCase() ?? "");
}

const WRITERS = new Set(["cp", "mv", "tee", "sed", "rm", "ln", "chmod", "truncate", "remove-item", "set-content"]);

/** A script run by its interpreter from a path outside the seat's copy and outside scratch space. */
function runsOutside(words: string[], rules: Rules, scratch: (path: string) => boolean): boolean {
  if (!rules.interpreter.test(words[0] ?? "")) return false;
  // A lone `-` is code on stdin, the command's own; a script named by a variable other than home is one the watch cannot place.
  const script = words.slice(1).find((word) => !word.startsWith("-") || word === "-");
  if (!script || script === "-" || /^\$(?!\{?HOME\b)/.test(script)) return false;
  if (scratch(script) || inside(script)) return false;
  const path = script.replace(/^(?:~|\$\{?HOME\}?)(?=\/)/, "/home");
  return !(rules.cwd && isAbsolute(path) && !relative(rules.cwd, path).startsWith(".."));
}

/** A command that reads, prints, dumps or stages a secret: a secret path among what it reads, or a command that shows secrets. */
function touchesSecret(words: string[], part: string, rules: Rules): boolean {
  const command = words[0]?.toLowerCase() ?? "";
  if (command === "rm" || command === "remove-item") return false;
  // What cp and mv write to is not read.
  const read = command === "cp" || command === "mv" ? words.slice(1, -1) : words.slice(1);
  return (rules.secretCommand.test(part.trim()) && !namesOnly(part)) || read.some((word) => secretFile(word, rules));
}

/** What keeps only the part before `=` of each line: a name, never its value. */
const NAMES = [
  /^grep\b(?=[^=]*$)(?=.*\s-[a-zA-Z]*o)/,
  /^cut\b(?=.*-d\s*['"]?=['"]?(?:\s|$))(?=.*-f\s*1(?:\s|$))/,
  /^sed\b.*\bs\/=\.\*\/[^/\\]*\//,
  /^awk\b(?=.*-F\s*['"]?=['"]?\s)(?=.*print \$1\b)/,
];

/** An environment dump piped through something that cuts every value away before it prints: only names are shown. */
function namesOnly(part: string): boolean {
  const stages: string[] = [];
  let stage = "";
  let quote: string | undefined;
  for (const char of part) {
    if (quote) quote = char === quote ? undefined : quote;
    else if (char === "'" || char === '"') quote = char;
    else if (char === "|") {
      stages.push(stage.trim());
      stage = "";
      continue;
    }
    stage += char;
  }
  stages.push(stage.trim());
  return stages.length > 1 && stages.slice(1).some((later) => NAMES.some((names) => names.test(later)));
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
