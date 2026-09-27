import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TeamPanel } from "./client/ui/panel/team-panel.tsx";
import { addWaitingPills } from "./client/ui/pill/waiting.tsx";
import { SeatworksSurface } from "./client/ui/settings/surface.tsx";
import { addTimelineRows } from "./client/ui/timeline/rows.tsx";

/** Seatworks plugs into Paseo's own places: its sidebar page, a tab beside Files and Changes, rows and pills in chats. */
export default function contribute(client: PluginClientContext) {
  const surface = client.addSurface("seatworks", SeatworksSurface);
  const sidebar = client.addSidebarItem({ id: "seatworks", title: "Seatworks", icon: "Users", surface: "seatworks" });
  const panel = client.addWorkspacePanel({
    id: "team",
    title: "Team",
    icon: "Network",
    context: "workspace",
    locations: ["explorer"],
    Component: TeamPanel,
  });
  const rows = addTimelineRows(client);
  const pills = addWaitingPills(client);
  return async () => {
    pills();
    for (const remove of rows) await remove();
    await panel();
    await sidebar();
    await surface();
  };
}
