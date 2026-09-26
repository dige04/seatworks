/** The model is shown each schema as written; whoever serves the call checks what it is sent, in its own words. */
export const unchecked = { getValidator: () => (input) => ({ valid: true, data: input, errorMessage: undefined }) };

const PROGRESS_MS = Number(process.env.SEATWORKS_PROGRESS_MS ?? 20_000);

/**
 * Progress for a harness that asked for it: `still` that often while a call runs, which also keeps a harness that counts
 * idle time waiting, and `say` for more; nothing when it did not ask.
 */
export function ticker(ctx, still) {
  const token = ctx?.mcpReq._meta?.progressToken;
  if (token === undefined) return undefined;
  let beat = 0;
  const say = (message) => void ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken: token, progress: ++beat, message } }).catch(() => {});
  const timer = setInterval(() => say(still), PROGRESS_MS);
  return { say, stop: () => clearInterval(timer) };
}
