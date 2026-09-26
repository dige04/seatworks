import { git } from "../../core/git.ts";
import { clip } from "../../core/text.ts";
import { type Caller, type ToolReply, no, ok } from "../context.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { loadConfig } from "./project.ts";

/**
 * Sends the project's base where the Human's own git would push it, with a release tag on its head when it names one.
 * Never forced, and the project's own push hooks run as they would.
 */
export async function pushBase(
  { teamFor }: Pick<DeskServices, "teamFor">,
  caller: Caller,
  args: { tag?: string; message?: string },
): Promise<ToolReply> {
  const { project } = caller;
  if (teamFor(project).hitl.on)
    return no("Pushing and releasing are the Human's while they are in the loop: tell them what is ready to go out.");
  const { root } = project;
  const base = loadConfig(project.state).base;
  if (!base) return no("This project has no base on record: set_project names it.");
  // Git's own order: the branch's pushRemote, then remote.pushDefault, then the remote it tracks.
  const remote = (await git(root, ["for-each-ref", "--format=%(push:remotename)", `refs/heads/${base}`])).stdout.trim();
  if (!remote)
    return no(
      `Nothing was pushed: ${base} names no remote to push to, as git reads it (its pushRemote, remote.pushDefault, or the remote it tracks); only the Human can set one.`,
    );
  if ((await git(root, ["remote", "get-url", remote])).code !== 0)
    return no(
      `Nothing was pushed: ${base} pushes to ${remote}, which is no remote here; only the Human can set one up.`,
    );
  const tag = args.tag?.trim();
  if (tag) {
    if ((await git(root, ["check-ref-format", `refs/tags/${tag}`])).code !== 0)
      return no(`${tag} is not a name git takes for a tag.`);
    if ((await git(root, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`])).code === 0)
      return no(`Nothing was pushed: the tag ${tag} is here already; name the release another way.`);
  }
  const pushed = await git(root, ["push", remote, `refs/heads/${base}:refs/heads/${base}`], 300_000);
  if (pushed.code !== 0) return notPushed(root, remote, base, pushed.stderr);
  const untagged = tag ? await pushTag(root, remote, base, tag, args.message) : undefined;
  if (untagged) return no(`Pushed ${base} to ${remote}, but not the tag ${tag}: ${untagged}`);
  recordEvent(project, { kind: "base.pushed", base, remote, tag: tag ?? null, by: caller.id });
  return ok(`Pushed ${base}${tag ? ` and the tag ${tag}` : ""} to ${remote}.`);
}

/** Why a push of `base` was refused, and the way on when `remote` holds commits `base` here lacks. */
async function notPushed(root: string, remote: string, base: string, stderr: string): Promise<ToolReply> {
  const ahead = await aheadOfBase(root, remote, base);
  if (ahead === 0) return no(`Nothing was pushed to ${remote}: ${clip(stderr.trim(), 600)}`);
  const commits = ahead === 1 ? "1 commit" : `${ahead} commits`;
  return no(
    `Nothing was pushed: ${remote} has ${commits} on ${base} that ${base} here lacks, and a push is never forced. Taking ${ahead === 1 ? "it" : "them"} in is a lane's work: open_lane with a task whose Peer merges ${remote}/${base}, fetched now, into its own branch and settles what conflicts; land that lane, then push again.`,
  );
}

/** Tags base's head once base is out and sends the tag; one that does not go out is dropped, to be tried again. */
async function pushTag(
  root: string,
  remote: string,
  base: string,
  tag: string,
  message: string | undefined,
): Promise<string | undefined> {
  const made = await git(root, ["tag", "-a", tag, "-m", message?.trim() || tag, base]);
  if (made.code !== 0) return `it was not made: ${clip(made.stderr.trim(), 400)}`;
  const pushed = await git(root, ["push", remote, `refs/tags/${tag}`], 300_000);
  if (pushed.code === 0) return undefined;
  await git(root, ["tag", "-d", tag]);
  return `${clip(pushed.stderr.trim(), 600)} It is not kept here either; push again with it once that clears.`;
}

/** How many commits `remote` has on `base` that the local `base` lacks, fetched into `remote`/`base` to count them. */
async function aheadOfBase(root: string, remote: string, base: string): Promise<number> {
  const tracking = `refs/remotes/${remote}/${base}`;
  if ((await git(root, ["fetch", "--quiet", remote, `+refs/heads/${base}:${tracking}`], 300_000)).code !== 0) return 0;
  return Number((await git(root, ["rev-list", "--count", `${base}..${tracking}`])).stdout.trim()) || 0;
}
