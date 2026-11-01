/**
 * Where the hosted workspace lives.
 *
 * A build with no key falls back to the bundled demo. A screen that needs the
 * hosted project calls `requireCloudConfig` and fails closed instead.
 */

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/** The project the desktop auth flow already talks to. */
export const DEFAULT_SUPABASE_URL = "https://imzdblvljdcbnxtwbmbw.supabase.co";

export const supabaseUrl = rawUrl || DEFAULT_SUPABASE_URL;
export const supabaseAnonKey = rawKey ?? "";

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

export function cloudConfigured(): boolean {
  return supabaseAnonKey !== "";
}

/** Refuses to start a production page that would silently use demo data. */
export function requireCloudConfig(): { url: string; key: string } {
  if (!cloudConfigured()) throw new MissingCloudConfigError();
  return { url: supabaseUrl, key: supabaseAnonKey };
}
