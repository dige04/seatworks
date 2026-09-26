/** When something happened, as the panel says it everywhere. */
export const ago = (minutes: number): string =>
  minutes < 1 ? "just now" : minutes < 90 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;

/** How long something has gone on; "just now" is no duration, so under a minute reads as that. */
export const lasting = (minutes: number): string => (minutes < 1 ? "just now" : `${minutes} min`);
