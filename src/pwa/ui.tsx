import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { CloudOff, Loader2, RefreshCw } from "lucide-react";
import type { SyncStatus } from "../lib/sync/engine";
import styles from "./pwa.module.css";

export function Button({
  variant = "primary",
  loading = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      className={[styles.button, styles[variant], className].filter(Boolean).join(" ")}
      disabled={rest.disabled || loading}
    >
      {loading ? <Loader2 aria-hidden size={17} className={styles.spin} /> : null}
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "section" | "li";
}) {
  return <Tag className={[styles.card, className].filter(Boolean).join(" ")}>{children}</Tag>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={[styles.input, props.className].filter(Boolean).join(" ")} />;
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
  children: ReactNode;
}) {
  return <span className={[styles.pill, styles[`pill_${tone}`]].join(" ")}>{children}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyBody}>{body}</p>
    </div>
  );
}

export function SyncBar({ status, onRetry }: { status: SyncStatus; onRetry: () => void }) {
  const label = status.running
    ? "Syncing…"
    : !status.online
      ? "Working offline. Changes are saved on this device."
      : status.pending > 0
        ? `${status.pending} change${status.pending === 1 ? "" : "s"} waiting to upload`
        : "Up to date";
  return (
    <div
      className={[styles.syncBar, !status.online ? styles.syncBarOffline : ""].join(" ")}
      role="status"
      aria-live="polite"
    >
      {status.online ? (
        <span className={styles.syncDot} aria-hidden />
      ) : (
        <CloudOff aria-hidden size={15} />
      )}
      <span>{label}</span>
      {!status.running ? (
        <button type="button" className={styles.syncRetry} onClick={onRetry}>
          <RefreshCw aria-hidden size={13} /> Retry now
        </button>
      ) : null}
    </div>
  );
}

export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0h";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((then - now) / 60_000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

/**
 * The browser fires this once, and only for an installable page. Keeping the
 * event means the button can install without a second prompt.
 */
export function useInstallPrompt(): { canInstall: boolean; install: () => Promise<void> } {
  const event = useRef<Event | null>(null);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    const capture = (caught: Event) => {
      caught.preventDefault();
      event.current = caught;
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", capture);
    const installed = () => {
      event.current = null;
      setCanInstall(false);
    };
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  return {
    canInstall,
    install: async () => {
      const prompt = event.current as (Event & { prompt?: () => Promise<void> }) | null;
      await prompt?.prompt?.();
      event.current = null;
      setCanInstall(false);
    },
  };
}

export function PageTitle({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <header className={styles.pageTitle}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1>{title}</h1>
      {body ? <p className={styles.pageBody}>{body}</p> : null}
    </header>
  );
}
