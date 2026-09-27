import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { catalogRpc, projectsRpc, teamRpc } from "../../shared/rpc.ts";
import type { CatalogView } from "../../shared/views.ts";
import { message } from "../format/error.ts";
import { useLatest } from "./latest.ts";

type Found =
  | { status: "reading" }
  | { status: "none" }
  | { status: "error"; error: string }
  | { status: "project"; slug: string; catalog: CatalogView; human: boolean };

/** The Seatworks project a Paseo workspace belongs to, by its project root, with the kit's words and whether the Human is in the loop. */
export function useWorkspaceProject(workspaceId: string): Found {
  const root = useWorkspace(workspaceId, (workspace) => workspace.projectRootPath);
  const calls = useLatest({ projects: useRpc(projectsRpc), catalog: useRpc(catalogRpc), team: useRpc(teamRpc) });
  const [found, setFound] = useState<Found>({ status: "reading" });
  useEffect(() => {
    if (!root) return;
    let alive = true;
    const read = async (): Promise<Found> => {
      const [projects, catalog] = await Promise.all([calls.current.projects({}), calls.current.catalog({})]);
      const project = projects.find((entry) => entry.root === root);
      if (!project) return { status: "none" };
      const team = await calls.current.team({ project: project.slug });
      if ("error" in team) return { status: "error", error: team.error };
      return { status: "project", slug: project.slug, catalog, human: team.hitl.on };
    };
    read().then(
      (next) => alive && setFound(next),
      (problem: unknown) => alive && setFound({ status: "error", error: message(problem) }),
    );
    return () => {
      alive = false;
    };
  }, [root]);
  return found;
}
