export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const asError = (reason: unknown): Error => (reason instanceof Error ? reason : new Error(String(reason)));
