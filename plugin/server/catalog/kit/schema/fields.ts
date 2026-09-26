import { z } from "zod";

export const text = z.string().min(1);
export const texts = z.array(z.string());
export const Json = z.record(z.string(), z.unknown());
