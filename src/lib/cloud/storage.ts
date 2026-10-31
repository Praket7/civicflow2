/**
 * A single Supabase session, kept in the operating system credential store.
 *
 * Supabase writes the session as one JSON string. The adapter keeps a memory
 * copy so a screen can read it synchronously after the first load, and writes
 * through to the keychain so a restart does not require another sign-in.
 */

export interface CredentialStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

export const CLOUD_SESSION_KEY = "civicflow.desktop.cloud";

async function invokeKeychain<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

/** The native desktop uses the OS keychain; the browser preview uses local storage. */
export function credentialStore(): CredentialStore {
  const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (desktop) {
    return {
      read: () => invokeKeychain<string | null>("load_cloud_session"),
      write: (value) => invokeKeychain<void>("save_cloud_session", { value }),
      remove: () => invokeKeychain<void>("clear_cloud_session"),
    };
  }
  return {
    read: async () => {
      try {
        return localStorage.getItem(CLOUD_SESSION_KEY);
      } catch {
        return null;
      }
    },
    write: async (value) => {
      try {
        localStorage.setItem(CLOUD_SESSION_KEY, value);
      } catch {
        // A blocked store only costs the next sign-in.
      }
    },
    remove: async () => {
      try {
        localStorage.removeItem(CLOUD_SESSION_KEY);
      } catch {
        // Nothing to remove.
      }
    },
  };
}

export class CloudSessionStorage {
  private loaded = false;
  private value: string | null = null;

  constructor(private readonly store: CredentialStore = credentialStore()) {}

  private async load(): Promise<string | null> {
    if (this.loaded) return this.value;
    try {
      this.value = await this.store.read();
    } catch {
      // A missing or locked credential store must not block the app. The
      // session then lasts for this launch only.
      this.value = null;
    }
    this.loaded = true;
    return this.value;
  }

  async getItem(key: string): Promise<string | null> {
    if (key !== CLOUD_SESSION_KEY && !key.endsWith("auth-token")) return null;
    return this.load();
  }

  async setItem(key: string, value: string): Promise<void> {
    if (key !== CLOUD_SESSION_KEY && !key.endsWith("auth-token")) return;
    this.value = value;
    this.loaded = true;
    try {
      await this.store.write(value);
    } catch {
      // Keep the memory copy; the session still works until the app closes.
    }
  }

  async removeItem(key: string): Promise<void> {
    if (key !== CLOUD_SESSION_KEY && !key.endsWith("auth-token")) return;
    this.value = null;
    this.loaded = true;
    try {
      await this.store.remove();
    } catch {
      // Nothing else to clear.
    }
  }
}
