import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { describeAuthError } from "../auth/errors";
import type { BridgedSession } from "../cloud/bridge";
import { cloudClient } from "../cloud/client";
import { isTauri } from "../platform";
import { MissingCloudConfigError, requireCloudConfig } from "./config";

let cached: SupabaseClient | null = null;
let bridged: BridgedSession | null | undefined;

/**
 * Switches this document to the session handed over by the desktop window.
 * `undefined` means the handshake never happened, so the page behaves like the
 * ordinary browser app it also is.
 */
export function adoptBridgedSession(session: BridgedSession | null): void {
  bridged = session;
  cached = null;
}

/** A memory store: the desktop already owns the only refresh token on disk. */
function memoryStorage() {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
}

/**
 * The client behind the shared workspace, in either shell.
 *
 * On the desktop it is the same client the settings card signs in with, so the
 * session lives in the operating system credential store and one sign-in covers
 * both. In a browser the session belongs to the volunteer and stays in the page.
 */
export function supabase(): SupabaseClient {
  if (cached) return cached;
  const { url, key } = requireCloudConfig();
  // A session handed over by the desktop window wins: it works even where the
  // frame has no IPC bridge of its own, and it never touches page storage.
  if (bridged) {
    cached = createClient(url, key, {
      auth: {
        storage: memoryStorage(),
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    });
    return cached;
  }
  if (isTauri()) {
    const desktop = cloudClient();
    if (!desktop) throw new MissingCloudConfigError();
    cached = desktop;
    return cached;
  }
  cached = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      storageKey: "civicflow.volunteer.auth",
    },
  });
  return cached;
}

export interface Workspace {
  organizationId: string;
  role: "owner" | "coordinator" | "volunteer";
  status: "active" | "invited" | "disabled";
  membershipEpoch: number;
  volunteerId: string | null;
  joinedAt: string;
  organization: {
    id: string;
    name: string;
    initials: string;
    timezone: string;
    visibility: string;
    image: string | null;
  };
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const { data, error } = await supabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(describeAuthError(error.message));
  if (!data.session) throw new Error("The provider accepted the sign-in but returned no session.");
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase().auth.signOut();
  if (error) throw new Error(describeAuthError(error.message));
}

export async function currentSession(): Promise<Session | null> {
  const { data, error } = await supabase().auth.getSession();
  if (error) return null;
  return data.session;
}

export function onAuthChange(listener: (session: Session | null) => void): () => void {
  const { data } = supabase().auth.onAuthStateChange((_event, session) => listener(session));
  return () => data.subscription.unsubscribe();
}

/** A display name for the profile row; the provider owns only the email. */
export async function ensureProfile(name: string | null): Promise<void> {
  const { error } = await supabase().rpc("ensure_profile", { p_name: name });
  if (error) throw new Error(error.message);
}

/**
 * Membership, not metadata. The server decides this list, and a role in a
 * provider token is never read.
 */
export async function myWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await supabase().rpc("my_workspaces");
  if (error) throw new Error(error.message);
  const result = data as { status?: string; workspaces?: Workspace[] } | null;
  if (!result || result.status !== "ok") {
    throw new Error("This account has no workspace it can open yet.");
  }
  return result.workspaces ?? [];
}

export function displayNameOf(user: User): string {
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const name = typeof metadata?.name === "string" ? metadata.name.trim() : "";
  if (name) return name;
  return user.email?.split("@")[0] ?? "Volunteer";
}
