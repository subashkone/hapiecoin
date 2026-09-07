import { z } from "zod";

/** Machine-readable error codes are SCREAMING_SNAKE_CASE so clients can switch on them. */
export const ApiErrorCode = z.string().regex(/^[A-Z][A-Z0-9_]*$/, "expected an error code such as NOT_FOUND");
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** Error body returned by every HTTP endpoint on failure. */
export const ApiError = z.object({
  code: ApiErrorCode,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

/** Cursor-paginated list envelope. `nextCursor` is null on the last page. */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().min(1).nullable(),
    total: z.number().int().nonnegative().optional(),
  });
}

/** Type of a parsed `paginated(item)` value; `total` may be absent or undefined (exactOptionalPropertyTypes). */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  total?: number | undefined;
}
