import type { Attention } from "../../../shared/views.ts";

export const ATTENTION: Omit<Attention, "destructive" | "testPath" | "suppressed"> = {
  tickSeconds: 30,
  leadIdleMinutes: 12,
  askWaitingMinutes: 15,
  askLapseMinutes: 45,
  signals: {},
  repeatsAt: 3,
  recoverWithin: 10,
  reworksAt: 3,
  reviewsAt: 3,
  longTurnMinutes: 30,
  lookMinutes: 5,
  incidentsPerLane: 2,
  brain: "off",
  sensor: "",
};
