import { useRpc, usePaseo } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  catalogRpc,
  doctorRpc,
  mcpParseRpc,
  pathsRpc,
  projectsAddRpc,
  projectsCandidatesRpc,
  projectsRemoveRpc,
  projectsRpc,
  settingsReadRpc,
  settingsWriteRpc,
  statusRpc,
  teamPreviewRpc,
  teamRpc,
} from "../../shared/rpc.ts";
import type { Layer } from "../../shared/settings.ts";
import type { CatalogView, ProjectRow, TeamView } from "../../shared/views.ts";
import { message } from "../format/error.ts";
import { useLatest } from "./latest.ts";
import { keptRoles, setMcp } from "../model/layer.ts";

export type PaseoProject = { name: string; root: string };

type Data =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "ready";
      of: string;
      catalog: CatalogView;
      team: TeamView;
      projects: ProjectRow[];
      known: PaseoProject[];
      candidates: PaseoProject[];
      values: Layer;
      machine: Layer;
      revision: string;
      settingsError: string | null;
    };

/** The projects Paseo itself knows, which a setup screen offers; none when Paseo cannot say. */
async function paseoProjects(paseo: ReturnType<typeof usePaseo>): Promise<PaseoProject[]> {
  try {
    const listed = (await paseo.projects.list()) as {
      projects?: { projectDisplayName?: string; projectRootPath?: string }[];
    };
    return (listed.projects ?? [])
      .filter(
        (entry): entry is { projectDisplayName?: string; projectRootPath: string } =>
          typeof entry.projectRootPath === "string",
      )
      .map((entry) => ({ name: entry.projectDisplayName ?? entry.projectRootPath, root: entry.projectRootPath }));
  } catch {
    return [];
  }
}

export function useSeatworks(project?: string) {
  const bound = {
    catalog: useRpc(catalogRpc),
    projects: useRpc(projectsRpc),
    add: useRpc(projectsAddRpc),
    remove: useRpc(projectsRemoveRpc),
    candidates: useRpc(projectsCandidatesRpc),
    parseMcp: useRpc(mcpParseRpc),
    settings: useRpc(settingsReadRpc),
    write: useRpc(settingsWriteRpc),
    team: useRpc(teamRpc),
    preview: useRpc(teamPreviewRpc),
    doctor: useRpc(doctorRpc),
    status: useRpc(statusRpc),
    paths: useRpc(pathsRpc),
  };
  const paseo = usePaseo();
  const latest = useLatest(bound);
  const [data, setData] = useState<Data>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  // Set by a save, cleared by its reload: the controls stay locked until drawn from what it produced.
  const settling = useRef(false);
  // Tagged with its screen: the hook serves every screen.
  const [refusal, setRefusal] = useState<{ of: string; text: string } | null>(null);
  // A ref, so a callback built on an earlier render still tags the screen open now.
  const here = useRef(project ?? "");
  here.current = project ?? "";
  const setSaveError = useCallback(
    (text: string | null) => setRefusal(text === null ? null : { of: here.current, text }),
    [],
  );
  const saveError = refusal?.of === (project ?? "") ? refusal.text : null;
  // Whether the last write went, apart from any other screen's refusal.
  const [saved, setSaved] = useState<boolean | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      const call = latest.current;
      const [catalog, projects, team, settings, known] = await Promise.all([
        call.catalog({}),
        call.projects({}),
        call.team({ project }),
        call.settings({ project }),
        paseoProjects(paseo),
      ]);
      const offerable = new Set(
        known.length > 0 ? await call.candidates({ roots: known.map((entry) => entry.root) }) : [],
      );
      if (!alive) return;
      if ("error" in team) throw new Error(team.error);
      if (settling.current) {
        settling.current = false;
        setSaving(false);
      }
      setData({
        status: "ready",
        of: project ?? "",
        catalog,
        projects,
        known,
        candidates: known.filter((entry) => offerable.has(entry.root)),
        team,
        values: settings.status === "ready" ? settings.values : {},
        machine: settings.machine,
        revision: settings.revision,
        settingsError: settings.status === "ready" ? null : settings.error,
      });
    };
    // Only a move to another screen blanks it, so a save's reload keeps each section's local state.
    setData((held) => (held.status === "ready" && held.of === (project ?? "") ? held : { status: "loading" }));
    load().catch((error: unknown) => {
      if (!alive) return;
      if (settling.current) {
        settling.current = false;
        setSaving(false);
      }
      setData({ status: "error", error: message(error) });
    });
    return () => {
      alive = false;
    };
  }, [project, nonce, paseo]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  /** Every desk write runs inside this, locked until the reload it ends in: a click on the view before it cannot undo it. */
  const writing = useCallback(
    async <T>(run: () => Promise<T>, failed: T): Promise<T> => {
      setSaving(true);
      setSaveError(null);
      try {
        return await run();
      } catch (error) {
        setSaveError(message(error));
        setSaved(false);
        return failed;
      } finally {
        settling.current = true;
        reload();
      }
    },
    [reload],
  );

  const save = useCallback(
    async (change: (values: Layer) => Layer): Promise<boolean> => {
      if (data.status !== "ready") return false;
      return writing(async () => {
        const result = await latest.current.write({ project, revision: data.revision, values: change(data.values) });
        if (result.status !== "saved") {
          setSaveError(result.error);
          setSaved(false);
          return false;
        }
        setSaved(true);
        return true;
      }, false);
    },
    [data, project, writing],
  );

  /** Attaches `root` with the setup the screen chose, in one call: the desk folds it into what the project holds. */
  const attach = useCallback(
    async (root: string, values: Layer): Promise<{ slug: string; note?: string } | null> => {
      return writing(async () => {
        const added = await latest.current.add({ root, values });
        if ("error" in added) {
          setSaveError(added.error);
          setSaved(false);
          return null;
        }
        if (added.refused) {
          // Filed under the project the dialog is about to open, which is where it has to be read.
          setRefusal({ of: added.slug, text: added.refused });
          setSaved(false);
          return { slug: added.slug, note: added.note };
        }
        setSaved(true);
        return { slug: added.slug, note: added.note };
      }, null);
    },
    [writing],
  );

  const detach = useCallback(
    async (slug: string): Promise<boolean> => {
      return writing(async () => {
        const result = await latest.current.remove({ project: slug });
        if ("error" in result) {
          setSaveError(result.error);
          setSaved(false);
          return false;
        }
        setSaved(true);
        return true;
      }, false);
    },
    [writing],
  );

  const addServer = useCallback(
    async (text: string): Promise<string | null> => {
      setSaveError(null);
      try {
        const parsed = await latest.current.parseMcp({ text });
        if ("error" in parsed) {
          setSaveError(parsed.error);
          return null;
        }
        const id = parsed.id.trim();
        if (!id) {
          setSaveError('That snippet does not name the server; paste it as {"mcp": {"name": { … }}}.');
          return null;
        }
        // Only to roles whose agent can reach it: the desk refuses the rest, and the narrowing control appears once saved.
        if (data.status !== "ready") return null;
        const harnessOf = (role: string) => data.team.roles[role]?.harness;
        const reachable = data.catalog.roles
          .filter((role) =>
            (data.catalog.harnesses.find((entry) => entry.id === harnessOf(role.id))?.transports ?? []).includes(
              parsed.connect.type,
            ),
          )
          .map((role) => role.id);
        if (reachable.length === 0) {
          setSaveError(`No role's agent can reach a ${parsed.connect.type} server, so there is nobody to give it to.`);
          return null;
        }
        // A re-paste updates the connection, so the owner's narrowing is kept, intersected with what can reach the transport.
        const narrowed = data.values.mcp?.[id]?.roles;
        const roles = keptRoles(narrowed, reachable);
        if (narrowed?.length && roles.length === 0) {
          setSaveError(
            `This server is given to ${narrowed.join(", ")}, and no agent of theirs can reach a ${parsed.connect.type} server. Widen the roles on its own tab first.`,
          );
          return null;
        }
        const saved = await save((values) =>
          setMcp(values, id, {
            enabled: true,
            label: parsed.label || id,
            connect: parsed.connect,
            removed: false,
            roles,
          }),
        );
        // The snippet is the owner's only copy of what they pasted; it is not thrown away on a refusal.
        return saved ? id : null;
      } catch (error) {
        setSaveError(message(error));
        return null;
      }
    },
    [data, save],
  );

  const readServer = useCallback((text: string) => latest.current.parseMcp({ text }), []);
  const listFolders = useCallback((path?: string) => latest.current.paths(path ? { path } : {}), []);
  const runDoctor = useCallback(() => latest.current.doctor({ project }), [project]);
  const readStatus = useCallback((slug: string) => latest.current.status({ project: slug }), []);
  // The setup screen previews the project it is pointed at, which is not the one open here.
  const previewTeam = useCallback((root: string, values: Layer) => latest.current.preview({ root, values }), []);
  return {
    data,
    save,
    reload,
    saving,
    saved,
    saveError,
    addServer,
    readServer,
    attach,
    detach,
    listFolders,
    runDoctor,
    readStatus,
    previewTeam,
  };
}
