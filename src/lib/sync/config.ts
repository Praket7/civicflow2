/**
 * Where this build may read and write.
 *
 * A browser build with no cloud configuration must never pretend to be a
 * shared workspace: it falls back to the bundled demo only when the runtime is
 * explicitly `demo-preview`, and production fails closed.
 */

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/** The project the desktop auth flow already talks to. */
export const DEFAULT_SUPABASE_URL = "https://imzdblvljdcbnxtwbmbw.supabase.co";

export const supabaseUrl = rawUrl || DEFAULT_SUPABASE_URL;
export const supabaseAnonKey = rawKey ?? "";

export type Runtime =
  "desktop-local" | "desktop-synced" | "web-production" | "demo-preview" | "test";

export class MissingCloudConfigError extends Error {
  readonly code = "missing_cloud_config";

  constructor() {
    super(
      "This build is configured for the shared workspace but has no Supabase key. " +
        "Set VITE_SUPABASE_ANON_KEY before building the volunteer app.",
    );
    this.name = "MissingCloudConfigError";
  }
}

function tauriHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function cloudConfigured(): boolean {
  return supabaseAnonKey !== "";
}

/**
 * The explicit environment this page is running in.
 *
 * An explicit override wins so a production build cannot drift into preview
 * mode because a browser lacks the Tauri bridge.
 */
export function resolveRuntime(): Runtime {
  const declared = (import.meta.env.VITE_CIVICFLOW_RUNTIME as string | undefined)?.trim();
  if (
    declared === "desktop-local" ||
    declared === "desktop-synced" ||
    declared === "web-production" ||
    declared === "demo-preview" ||
    declared === "test"
  ) {
    return declared;
  }
  if (tauriHost()) return "desktop-local";
  return cloudConfigured() ? "web-production" : "demo-preview";
}

/** Refuses to start a production page that would silently use demo data. */
export function requireCloudConfig(): { url: string; key: string } {
  if (!cloudConfigured()) throw new MissingCloudConfigError();
  return { url: supabaseUrl, key: supabaseAnonKey };
}

export function isProductionWeb(): boolean {
  return resolveRuntime() === "web-production" || resolveRuntime() === "desktop-synced";
}
