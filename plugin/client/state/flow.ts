import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { flowRpc } from "../../shared/rpc.ts";
import type { FlowView } from "../../shared/flow-views.ts";
import { message } from "../format/error.ts";
import { useLatest } from "./latest.ts";

/** One project's Flow, read when it is opened and, while `live`, again every `everyMs`. */
export function useFlow(
  project: string | undefined,
  live: boolean,
  everyMs: number,
  openKey: string,
): { flow: FlowView | null; error: string | null } {
  const latest = useLatest(useRpc(flowRpc));
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) {
      setFlow(null);
      setError(null);
      return;
    }
    let alive = true;
    let since: string | undefined;
    const read = async (): Promise<void> => {
      try {
        const open = openKey ? openKey.split(",") : [];
        const answer = await latest.current(since ? { project, since, open } : { project, open });
        if (!alive) return;
        if ("error" in answer) {
          setError(answer.error);
          return;
        }
        setError(null);
        if ("unchanged" in answer) return;
        since = answer.revision;
        setFlow(answer);
      } catch (problem) {
        if (alive) setError(message(problem));
      }
    };
    void read();
    const timer = live ? setInterval(() => void read(), everyMs) : undefined;
    return () => {
      alive = false;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [project, live, everyMs, openKey]);

  return { flow, error };
}
