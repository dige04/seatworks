import { z } from "zod";
import { releaseKeptLead, releaseKeptPeer } from "../seats/kept.ts";
import { defineTool } from "../services.ts";

export const releasePeer = defineTool({
  name: "release",
  input: z.strictObject({ task: z.string() }),
  handle: (desk, caller, args) => releaseKeptPeer(desk, caller, args),
});

export const releaseLead = defineTool({
  name: "release",
  input: z.strictObject({ lane: z.string() }),
  handle: (desk, caller, args) => releaseKeptLead(desk, caller, args),
});
