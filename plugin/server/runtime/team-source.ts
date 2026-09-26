import { join } from "node:path";
import type { Kit } from "../catalog/kit/kit.ts";
import { layerValues, readLayer } from "../catalog/team/settings.ts";
import type { Layer } from "../../shared/settings.ts";
import { type Team, resolveTeam, servingProject } from "../catalog/team/team.ts";
import { stateRoot } from "../core/paths.ts";
import type { Project } from "../desk/project/project.ts";

/** The team a project runs with: the kit under the machine's settings layer and the project's over it. */
export class TeamSource {
  private readonly kit: Kit;

  constructor(kit: Kit) {
    this.kit = kit;
  }

  machineFile(): string {
    return join(stateRoot(), "settings.json");
  }

  projectFile(project: Project): string {
    return join(project.state, "settings.json");
  }

  machineLayer(): Layer {
    return layerValues(this.machineFile());
  }

  teamFor(project?: Project): Team {
    const machine = readLayer(this.machineFile());
    const local = project
      ? readLayer(this.projectFile(project))
      : { status: "ready" as const, values: {}, revision: "" };
    const unread = [
      ...(machine.status === "ready" ? [] : [`The machine settings are not being used: ${machine.error}`]),
      ...(local.status === "ready"
        ? []
        : [`The project settings are not being used: ${"error" in local ? local.error : "they could not be read"}`]),
    ];
    const team = resolveTeam(
      this.kit,
      machine.status === "ready" ? machine.values : {},
      local.status === "ready" ? local.values : {},
      unread,
    );
    return project ? servingProject(team, project.root) : team;
  }

  revision(project?: Project): string {
    const machine = readLayer(this.machineFile()).revision;
    const local = project ? readLayer(this.projectFile(project)).revision : "";
    return `${machine}:${local}`;
  }
}
