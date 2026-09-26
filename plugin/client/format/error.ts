export const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
