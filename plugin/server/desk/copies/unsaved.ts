import { pristineState, uncommittedIn } from "../../core/git.ts";

/**
 * What a copy holds that no commit does, as "has work uncommitted (…)"; nothing when all of it is committed. In the
 * Human's own checkout (`own`) files git does not track are theirs, not the lane's: only tracked changes count there.
 */
export async function unsavedIn(copy: string, own = false): Promise<string | undefined> {
  const state = await pristineState(copy, !own);
  if (state === "clean") return undefined;
  return state === "dirty" ? `has work uncommitted (${await uncommittedIn(copy, !own)})` : "could not be read by git";
}
