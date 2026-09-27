import { useState } from "react";
import { message } from "../../format/error.ts";

/** The desk's word back from one decision: what it did, or why it refused. */
export type Said = { text: string; refused: boolean };

/** One decision sent at a time, its answer kept to show under the card; `read` turns the RPC's answer into words. */
export function useSend<A>(read: (answer: A) => Said) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const send = (call: () => Promise<A>, after?: (said: Said) => void) => {
    setBusy(true);
    setSaid(null);
    void call()
      .then((answer) => {
        const words = read(answer);
        setSaid(words);
        after?.(words);
      })
      .catch((problem: unknown) => setSaid({ text: message(problem), refused: true }))
      .finally(() => setBusy(false));
  };
  return { busy, said, send };
}
