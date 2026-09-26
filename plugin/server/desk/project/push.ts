import { git } from "../../core/git.ts";
import { clip } from "../../core/text.ts";
import { type Caller, type ToolReply, no, ok } from "../context.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";
import { loadConfig } from "./project.ts";

/**
 * Sends the project's base to its remote for the Supervisor, with a release tag on its head when it names one: the
 * Supervisor's call while the Human is out of the loop, the Human's own while they are in it. Never forced: a remote that
 * moved on refuses it, and the project's own push hooks run as they would.
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
  const remote = (await git(root, ["config", "--get", `branch.${base}.remote`])).stdout.trim() || "origin";
  if ((await git(root, ["remote", "get-url", remote])).code !== 0)
    return no(`${base} has no remote ${remote} to go to; only the Human can set one up.`);
  const tag = args.tag?.trim();
  const refs = [`refs/heads/${base}:refs/heads/${base}`];
  if (tag) {
    if ((await git(root, ["check-ref-format", `refs/tags/${tag}`])).code !== 0)
      return no(`${tag} is not a name git takes for a tag.`);
    const made = await git(root, ["tag", "-a", tag, "-m", args.message?.trim() || tag, base]);
    if (made.code !== 0) return no(`Nothing was pushed: the tag ${tag} was not made: ${clip(made.stderr.trim(), 400)}`);
    refs.push(`refs/tags/${tag}`);
  }
  const pushed = await git(root, ["push", remote, ...refs], 300_000);
  if (pushed.code !== 0) {
    const kept = tag ? ` The tag ${tag} stays here, on ${base}.` : "";
    const ahead = await aheadOfBase(root, remote, base);
    if (ahead === 0) return no(`Nothing was pushed to ${remote}: ${clip(pushed.stderr.trim(), 600)}${kept}`);
    const commits = ahead === 1 ? "1 commit" : `${ahead} commits`;
    return no(
      `Nothing was pushed: ${remote} has ${commits} on ${base} that ${base} here lacks, and a push is never forced.${kept} Taking ${ahead === 1 ? "it" : "them"} in is a lane's work: open_lane with a task whose Peer merges ${remote}/${base}, fetched now, into its own branch and settles what conflicts; land that lane, then push again.`,
    );
  }
  recordEvent(project, { kind: "base.pushed", base, remote, tag: tag ?? null, by: caller.id });
  return ok(`Pushed ${base}${tag ? ` and the tag ${tag}` : ""} to ${remote}.`);
}

/** How many commits `remote` holds on `base` that the local `base` lacks, fetched into `remote`/`base` to count them. */
async function aheadOfBase(root: string, remote: string, base: string): Promise<number> {
  const tracking = `refs/remotes/${remote}/${base}`;
  if ((await git(root, ["fetch", "--quiet", remote, `+refs/heads/${base}:${tracking}`], 300_000)).code !== 0) return 0;
  return Number((await git(root, ["rev-list", "--count", `${base}..${tracking}`])).stdout.trim()) || 0;
}
