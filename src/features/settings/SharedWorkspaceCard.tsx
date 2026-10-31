import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Button, ButtonLink, TextField } from "../../components/ui";
import {
  cloudAvailable,
  cloudEmail,
  cloudSession,
  cloudSignIn,
  cloudSignOut,
  cloudWorkspaces,
  registerThisDesktop,
  type CloudWorkspace,
} from "../../lib/cloud/client";
import { desktopDevice } from "../../lib/cloud/device";
import { replicaId, writeWorkspace } from "../../lib/sync/db";

export function SharedWorkspaceCard() {
  const available = cloudAvailable();
  const [session, setSession] = useState<Session | null>(null);
  const [workspaces, setWorkspaces] = useState<CloudWorkspace[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(available);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [registered, setRegistered] = useState<string | null>(null);

  const loadWorkspaces = useCallback(async () => {
    try {
      setWorkspaces(await cloudWorkspaces());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    let active = true;
    void cloudSession()
      .then(async (current) => {
        if (!active) return;
        setSession(current);
        if (current) await loadWorkspaces();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [available, loadWorkspaces]);

  async function signIn() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const current = await cloudSignIn(email, password);
      setSession(current);
      setPassword("");
      await loadWorkspaces();
      setNotice("Connected. Choose an organization below.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await cloudSignOut();
      setSession(null);
      setWorkspaces([]);
      setRegistered(null);
      setNotice("Disconnected this desktop from the shared workspace.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function register(workspace: CloudWorkspace) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const device = desktopDevice();
      // The same id the shared workspace uses, so this computer is one row in
      // the health view rather than two.
      await registerThisDesktop(
        workspace.organizationId,
        await replicaId(),
        device.label,
        device.platform,
      );
      // The shared screen opens the organization just linked, not whichever
      // membership happened to be first.
      await writeWorkspace(workspace.organizationId);
      setRegistered(workspace.organizationId);
      setNotice(
        `This desktop is registered with ${workspace.organization.name}. The coordinator health page will list it.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 18,
        paddingTop: 14,
        borderTop: "1px solid var(--border-soft)",
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 590 }}>Shared workspace</div>
      <p style={{ marginTop: 3, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
        Connect this desktop to the hosted organization used by the volunteer app. The session is
        kept in the operating system credential store, not in the page.
      </p>

      {!available ? (
        <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
          This build has no shared-workspace configuration. Set `VITE_SUPABASE_ANON_KEY` before
          building the desktop app.
        </p>
      ) : loading ? (
        <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
          Checking the shared workspace…
        </p>
      ) : session ? (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: 0, fontSize: 12.5 }}>
            Connected as <strong>{cloudEmail(session)}</strong>.
          </p>
          {workspaces.length === 0 ? (
            <p style={{ marginTop: 6, fontSize: 12.5, color: "var(--text-muted)" }}>
              This account has no organization membership. Ask an owner for an invitation.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {workspaces.map((workspace) => (
                <li
                  key={workspace.organizationId}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    padding: "8px 0",
                    borderTop: "1px solid var(--border-soft)",
                  }}
                >
                  <span>
                    <span style={{ display: "block", fontSize: 13 }}>
                      {workspace.organization.name}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {workspace.role} · {workspace.status}
                    </span>
                  </span>
                  <Button
                    variant={registered === workspace.organizationId ? "ghost" : "secondary"}
                    disabled={busy || workspace.status !== "active"}
                    onClick={() => void register(workspace)}
                  >
                    {registered === workspace.organizationId ? "Registered" : "Register desktop"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <ButtonLink to="/shared" variant="secondary">
              Open shared workspace
            </ButtonLink>
            <Button variant="ghost" disabled={busy} onClick={() => void signOut()}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <form
          style={{ marginTop: 10, display: "grid", gap: 8, maxWidth: 360 }}
          onSubmit={(event) => {
            event.preventDefault();
            void signIn();
          }}
        >
          <TextField
            label="Hosted email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <TextField
            label="Hosted password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? "Connecting…" : "Connect"}
            </Button>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
            Use the account you use in the volunteer app, not the local workspace password.
          </p>
        </form>
      )}

      <div role="status" aria-live="polite" style={{ marginTop: 8, fontSize: 12.5 }}>
        {notice ? <span style={{ color: "var(--tone-green-ink)" }}>{notice}</span> : null}
        {error ? <span style={{ color: "var(--tone-red-ink)" }}>{error}</span> : null}
      </div>
    </div>
  );
}
