import { supabase } from "./auth";
import { supabaseAnonKey, supabaseUrl } from "./config";

export interface NotificationPreferences {
  inApp: boolean;
  push: boolean;
  email: boolean;
  sms: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  reminderMinutes: number;
}

export interface PushConfig {
  push: { configured: boolean; publicKey: string };
  channels: { email: boolean; sms: boolean };
}

export type PushState = "unsupported" | "blocked" | "available" | "subscribed";

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  inApp: true,
  push: false,
  email: false,
  sms: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  reminderMinutes: 1440,
};

const NO_CONFIG: PushConfig = {
  push: { configured: false, publicKey: "" },
  channels: { email: false, sms: false },
};

function dispatcherUrl(): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/dispatch-reminders`;
}

/** The key is public by design; email and SMS support are capabilities. */
export async function loadPushConfig(): Promise<PushConfig> {
  if (!supabaseAnonKey) return NO_CONFIG;
  try {
    const response = await fetch(dispatcherUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ action: "config" }),
    });
    if (!response.ok) return NO_CONFIG;
    const payload = (await response.json()) as Partial<PushConfig>;
    return {
      push: {
        configured: payload.push?.configured === true,
        publicKey: typeof payload.push?.publicKey === "string" ? payload.push.publicKey : "",
      },
      channels: {
        email: payload.channels?.email === true,
        sms: payload.channels?.sms === true,
      },
    };
  } catch {
    return NO_CONFIG;
  }
}

export async function loadPreferences(organizationId: string): Promise<NotificationPreferences> {
  const { data, error } = await supabase().rpc("my_notification_preferences", {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(error.message);
  const result = data as { status?: string; preferences?: Partial<NotificationPreferences> } | null;
  if (!result || result.status !== "ok" || !result.preferences) {
    throw new Error("Notification preferences could not be read.");
  }
  return { ...DEFAULT_PREFERENCES, ...result.preferences };
}

export async function savePreferences(
  organizationId: string,
  preferences: NotificationPreferences,
): Promise<void> {
  const { data, error } = await supabase().rpc("save_notification_preferences", {
    p_organization_id: organizationId,
    p_in_app: preferences.inApp,
    p_push: preferences.push,
    p_email: preferences.email,
    p_sms: preferences.sms,
    p_quiet_hours_start: preferences.quietHoursStart,
    p_quiet_hours_end: preferences.quietHoursEnd,
    p_reminder_minutes: preferences.reminderMinutes,
  });
  if (error) throw new Error(error.message);
  const result = data as { status?: string; code?: string } | null;
  if (!result || result.status !== "ok") {
    throw new Error(
      result?.code === "not_a_member"
        ? "This device no longer has access to that organization."
        : "The preferences were not saved.",
    );
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "default") return "available";
  try {
    const current = await (await registration()).pushManager.getSubscription();
    return current ? "subscribed" : "available";
  } catch {
    return "available";
  }
}

export async function enablePush(organizationId: string, publicKey: string): Promise<void> {
  if (!pushSupported()) {
    throw new Error(
      "This browser cannot receive push notifications. Install CivicFlow on your phone and open it from the Home Screen.",
    );
  }
  if (!publicKey) {
    throw new Error("Push notifications are not configured for this organization yet.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      "Notifications were not allowed. You can enable them in your browser settings.",
    );
  }

  const worker = await registration();
  let subscription = await worker.pushManager.getSubscription();
  if (!subscription) {
    subscription = await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(publicKey) as BufferSource,
    });
  }

  const serialized = subscription.toJSON();
  const p256dh = serialized.keys?.p256dh ?? "";
  const auth = serialized.keys?.auth ?? "";
  if (!p256dh || !auth) throw new Error("The browser returned an incomplete push subscription.");

  const { data, error } = await supabase().rpc("register_push_subscription", {
    p_organization_id: organizationId,
    p_endpoint: subscription.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_label: navigator.userAgent.includes("iPhone") ? "iPhone" : "This device",
  });
  if (error) throw new Error(error.message);
  const result = data as { status?: string; code?: string } | null;
  if (!result || result.status !== "ok") {
    throw new Error(
      result?.code === "not_a_member"
        ? "This device no longer has access to that organization."
        : "The push subscription was not saved.",
    );
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const worker = await registration();
  const subscription = await worker.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await supabase().rpc("revoke_push_subscription", { p_endpoint: subscription.endpoint });
  } finally {
    await subscription.unsubscribe();
  }
}

export async function markAllRead(organizationId: string): Promise<number> {
  const { data, error } = await supabase().rpc("mark_all_notifications_read", {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(error.message);
  const result = data as { status?: string; read?: number } | null;
  if (!result || result.status !== "ok") throw new Error("Notifications could not be marked read.");
  return result.read ?? 0;
}

export async function markRead(notificationId: string): Promise<void> {
  const { error } = await supabase().rpc("mark_notification_read", {
    p_notification_id: notificationId,
  });
  if (error) throw new Error(error.message);
}
