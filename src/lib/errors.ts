/**
 * A thrown value is not always an Error: the Tauri bridge can reject with a
 * string and a provider with an object. Every screen shows one sentence, so
 * the conversion lives here instead of in each catch block.
 */
export function messageOf(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  return fallback ?? String(error);
}
