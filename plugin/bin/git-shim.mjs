// A seat's git, first on its PATH: refuses what only the desk does to branches and working copies, however the command
// is spelled (-C, -c, --git-dir, an alias), and runs everything else as the real git would. A seat may move its own task
// branch (merge into it, rebase, reset, cherry-pick) but no other. Run as: git-shim.mjs <git> <args>.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [git, ...argv] = process.argv.slice(2);

const VALUED = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env", "--list-cmds", "--attr-source"]);

const DESKS = new Set(["push", "pull", "checkout", "switch", "update-ref", "stash"]);

/** Commands that move the branch checked out: a seat's own when that is a task branch, as add_tasks names them. */
const MOVES = new Set(["merge", "rebase", "reset", "cherry-pick"]);
const TASK_BRANCH = /^task\//;

const OWN = new Set([...DESKS, ...MOVES, "add", "blame", "branch", "commit", "config", "diff", "fetch", "grep", "log", "ls-files", "rev-parse", "show", "status", "worktree"]);

/** The options git reads before its command, the command, and what follows it. */
function split(args) {
  let at = 0;
  while (at < args.length && args[at].startsWith("-")) at += VALUED.has(args[at]) ? 2 : 1;
  return { globals: args.slice(0, at), command: args[at], rest: args.slice(at + 1) };
}

/** Whether `arg` asks git branch to force, delete, rename or overwrite: git takes a long option cut short, as `--del`, and a value such as `-committerdate` is no cluster of flags. */
function rewritesBranch(arg) {
  if (arg.startsWith("--")) {
    const long = arg.slice(2).split("=")[0];
    return long !== "" && ["force", "delete", "move"].some((name) => name.startsWith(long));
  }
  return /^-[acCdDfhilmMqrtuv]+$/.test(arg) && /[fdDmMC]/.test(arg);
}

/** The branch checked out where `globals` point, or the one a rebase under way is moving; nothing on a detached head. */
function checkedOut(globals) {
  const read = (...args) => spawnSync(git, [...globals, ...args], { encoding: "utf-8" });
  const branch = read("symbolic-ref", "--short", "-q", "HEAD");
  if (branch.status === 0) return branch.stdout.trim();
  for (const dir of ["rebase-merge", "rebase-apply"]) {
    const head = read("rev-parse", "--path-format=absolute", "--git-path", `${dir}/head-name`);
    try {
      if (head.status === 0) return readFileSync(head.stdout.trim(), "utf-8").trim().replace(/^refs\/heads\//, "");
    } catch {
      // No rebase of that kind under way.
    }
  }
  return undefined;
}

/** Why `command` with `rest` is the desk's to run, not a seat's; nothing when it is the seat's. */
function refusal(command, rest, globals) {
  if (DESKS.has(command)) return `git ${command} moves branches or working copies, and that is the desk's to do`;
  if (MOVES.has(command)) {
    const branch = checkedOut(globals);
    if (!branch || !TASK_BRANCH.test(branch))
      return `git ${command} would move ${branch ?? "a detached head"}, and only a task's own branch is its seat's to move`;
  }
  if (command === "worktree" && rest[0] !== "list") return "git worktree changes working copies, and that is the desk's to do";
  if (command === "branch" && rest.some(rewritesBranch)) return "git branch that forces, deletes, renames or overwrites a branch is the desk's to do";
  return undefined;
}

/**
 * The words an alias stands for, read with the same options, so `git -c alias.p=push p` is read as a push; git ignores an
 * alias named for a command of its own. A shell alias comes back as its text, since what it runs cannot be read here.
 */
function expanded(globals, command) {
  if (OWN.has(command)) return undefined;
  const run = spawnSync(git, [...globals, "config", "--get", `alias.${command}`], { encoding: "utf-8" });
  const alias = run.status === 0 ? run.stdout.trim() : "";
  if (!alias) return undefined;
  return alias.startsWith("!") ? alias : alias.split(/\s+/);
}

function refuse(why) {
  process.stderr.write(`git: refused: ${why}. Say what you need to whoever gave you the work.\n`);
  process.exit(1);
}

let { globals, command, rest } = split(argv);
for (let depth = 0; command && depth < 10; depth++) {
  const why = refusal(command, rest, globals);
  if (why) refuse(why);
  const words = expanded(globals, command);
  if (!words) break;
  // git runs a shell alias with its own directory first on PATH, so the git inside it would pass this shim unread.
  if (typeof words === "string") refuse(`git ${command} is a shell alias, which runs git out of this check's sight; run its commands directly`);
  // An alias may open with options of git's own, as `-p push` does: its command is read after them.
  const again = split([...words, ...rest]);
  globals = [...globals, ...again.globals];
  ({ command, rest } = again);
}

const ran = spawnSync(git, argv, { stdio: "inherit" });
if (ran.error) {
  process.stderr.write(`git: ${ran.error.message}\n`);
  process.exit(127);
}
process.exit(ran.status ?? 1);
