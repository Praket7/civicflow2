import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button, TextField } from "../../components/ui";
import { useAuth } from "../../lib/auth/session";
import { messageOf } from "../../lib/errors";
import { getWorkspaceRepository } from "../../lib/workspace/repository";
import type { Account } from "../../types/domain";
import styles from "../records/Records.module.css";
import { SharedWorkspaceCard } from "./SharedWorkspaceCard";

export function AccountsSettingsCard() {
  const { user, token, signOut } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsError, setAccountsError] = useState("");
  const [resetFor, setResetFor] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!token) return;
    let active = true;
    getWorkspaceRepository()
      .listAccounts(token)
      .then((rows) => {
        if (active) setAccounts(rows);
      })
      .catch((caught: unknown) => {
        if (active) setAccountsError(messageOf(caught));
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function resetAccountPassword() {
    if (!token || !resetFor) {
      setAccountsError("Choose an account to reset.");
      return;
    }
    if (newPassword.length < 8) {
      setAccountsError("Use at least 8 characters for the new password.");
      return;
    }
    setResetBusy(true);
    setAccountsError("");
    try {
      await getWorkspaceRepository().resetPassword(token, resetFor, newPassword);
      const target = accounts.find((account) => account.id === resetFor);
      setNewPassword("");
      setResetFor("");
      if (target?.id === user?.id) {
        setSaved("Password changed. Sign in again with the new password.");
        await signOut();
      } else {
        setSaved(`Password reset for ${target?.email ?? "the selected account"}.`);
      }
    } catch (caught) {
      setAccountsError(messageOf(caught));
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <>
      <h2 className={styles.settingsTitle}>Local accounts</h2>
      <p className={styles.settingsSub}>
        Two roles share this device. Passwords are hashed with Argon2 and sessions expire
        automatically. Resetting a password signs that account out everywhere on this device.
      </p>
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {accounts.map((account) => (
          <div
            key={account.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 12px",
              border: "1px solid var(--border-soft)",
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 590 }}>{account.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                {account.email} · {account.role}
              </div>
            </div>
            <Button
              variant="secondary"
              size="small"
              icon={<KeyRound size={13} />}
              onClick={() => {
                setResetFor(account.id);
                setNewPassword("");
                setAccountsError("");
                setSaved("");
              }}
            >
              Reset password
            </Button>
          </div>
        ))}
      </div>
      {resetFor ? (
        <div style={{ marginTop: 14, maxWidth: 360 }}>
          <TextField
            label={`New password for ${accounts.find((account) => account.id === resetFor)?.email ?? "account"}`}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              setAccountsError("");
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
            <Button
              variant="primary"
              size="small"
              onClick={() => void resetAccountPassword()}
              disabled={resetBusy}
            >
              {resetBusy ? "Saving…" : "Set new password"}
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                setResetFor("");
                setNewPassword("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {accountsError ? (
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--tone-red-ink)" }} role="alert">
          {accountsError}
        </p>
      ) : null}
      {saved ? (
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--tone-green-ink)" }} role="status">
          {saved}
        </p>
      ) : null}
      <SharedWorkspaceCard />
    </>
  );
}
