import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { describeAuthError } from "../auth/errors";
import { cloudConfigured, supabaseAnonKey, supabaseUrl } from "../sync/config";
import { CloudSessionStorage, CLOUD_SESSION_KEY } from "./storage";

export interface CloudWorkspace {
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

let cached: SupabaseClient | null = null;

export function cloudAvailable(): boolean {
  return cloudConfigured();
}

/**
 * A second client, separate from the volunteer app. It uses the desktop
 * keychain instead of the volunteer's browser session, so signing out of one
 * does not disturb the other.
 */
export function cloudClient(): SupabaseClient | null {
  if (!cloudConfigured()) return null;
  cached ??= createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: new CloudSessionStorage(),
      storageKey: CLOUD_SESSION_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return cached;
}

/**
 * Fires on sign-in, sign-out and token refresh, so a framed workspace can be
 * handed the current session instead of polling for it.
 */
export function onCloudSessionChange(listener: (session: Session | null) => void): () => void {
  const client = cloudClient();
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => listener(session));
  return () => data.subscription.unsubscribe();
}

export async function cloudSession(): Promise<Session | null> {
  const client = cloudClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data.session;
}

export async function cloudSignIn(email: string, password: string): Promise<Session> {
  const client = cloudClient();
  if (!client) throw new Error("This build has no shared-workspace configuration.");
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(describeAuthError(error.message));
  if (!data.session) throw new Error("The provider accepted the sign-in but returned no session.");
  return data.session;
}

export async function cloudSignOut(): Promise<void> {
  const client = cloudClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw new Error(describeAuthError(error.message));
}

/** Membership, not metadata. The server decides which organizations are visible. */
export async function cloudWorkspaces(): Promise<CloudWorkspace[]> {
  const client = cloudClient();
  if (!client) return [];
  const { data, error } = await client.rpc("my_workspaces");
  if (error) throw new Error(error.message);
  const result = data as { status?: string; workspaces?: CloudWorkspace[] } | null;
  if (!result || result.status !== "ok") return [];
  return result.workspaces ?? [];
}

export async function registerThisDesktop(
  organizationId: string,
  replicaId: string,
  label: string,
  platform: string,
): Promise<void> {
  const client = cloudClient();
  if (!client) throw new Error("This build has no shared-workspace configuration.");
  const { data, error } = await client.rpc("register_device", {
    p_organization_id: organizationId,
    p_replica_id: replicaId,
    p_label: label,
    p_platform: platform,
  });
  if (error) throw new Error(error.message);
  const result = data as { status?: string; code?: string } | null;
  if (!result || result.status !== "ok") {
    throw new Error(
      result?.code === "not_a_member"
        ? "This account no longer belongs to that organization."
        : "The device was not registered.",
    );
  }
}

export function cloudEmail(session: Session | null): string {
  return session?.user.email ?? "";
}
