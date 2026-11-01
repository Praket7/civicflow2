import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui";
import { isTauri } from "../../lib/platform";
import { messageOf } from "../../lib/errors";

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "installing"; percent: number | null }
  | { kind: "ready" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

interface PendingUpdate {
  version: string;
  body: string | null;
  downloadAndInstall: (
    onEvent?: (event: {
      event: "Started" | "Progress" | "Finished";
      data?: { contentLength?: number; chunkLength?: number };
    }) => void,
  ) => Promise<void>;
}

export function UpdateCard() {
  const [state, setState] = useState<State>(isTauri() ? { kind: "idle" } : { kind: "unsupported" });
  const [pending, setPending] = useState<PendingUpdate | null>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((value) => {
        if (active) setVersion(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function check() {
    if (!isTauri()) {
      setState({ kind: "unsupported" });
      return;
    }
    setState({ kind: "checking" });
    try {
      const { check: checkForUpdate } = await import("@tauri-apps/plugin-updater");
      const update = await checkForUpdate();
      if (!update) {
        setPending(null);
        setState({ kind: "current" });
        return;
      }
      setPending(update as unknown as PendingUpdate);
      setState({
        kind: "available",
        version: update.version,
        notes: update.body ?? "",
      });
    } catch (caught) {
      setState({
        kind: "error",
        message: messageOf(caught),
      });
    }
  }

  async function install() {
    if (!pending) return;
    setState({ kind: "installing", percent: 0 });
    let received = 0;
    let total = 0;
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data?.contentLength ?? 0;
          setState({ kind: "installing", percent: total > 0 ? 0 : null });
        } else if (event.event === "Progress") {
          received += event.data?.chunkLength ?? 0;
          setState({
            kind: "installing",
            percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
          });
        } else {
          setState({ kind: "ready" });
        }
      });
      setState({ kind: "ready" });
    } catch (caught) {
      setState({
        kind: "error",
        message: messageOf(caught),
      });
    }
  }

  async function restart() {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (caught) {
      setState({
        kind: "error",
        message: messageOf(caught),
      });
    }
  }

  return (
    <div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
        Updates are signed. The app refuses a package that does not match the key shipped with this
        build.
      </p>

      {version ? (
        <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)" }}>
          This build is {version}.
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <Button
          variant="secondary"
          icon={<RefreshCw size={13} />}
          onClick={() => void check()}
          disabled={state.kind === "checking" || state.kind === "installing"}
        >
          {state.kind === "checking" ? "Checking…" : "Check for updates"}
        </Button>
        {state.kind === "available" ? (
          <Button variant="primary" icon={<Download size={13} />} onClick={() => void install()}>
            Install {state.version}
          </Button>
        ) : null}
        {state.kind === "ready" ? (
          <Button variant="primary" onClick={() => void restart()}>
            Restart to finish
          </Button>
        ) : null}
      </div>

      <div role="status" aria-live="polite" style={{ marginTop: 10, fontSize: 12.5 }}>
        {state.kind === "current" ? <span>This is the latest release.</span> : null}
        {state.kind === "available" ? (
          <div>
            <p style={{ margin: 0, color: "var(--tone-blue-ink)" }}>
              Version {state.version} is available.
            </p>
            {state.notes ? (
              <p style={{ margin: "6px 0 0", color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>
                {state.notes.slice(0, 600)}
              </p>
            ) : null}
          </div>
        ) : null}
        {state.kind === "installing" ? (
          <span>
            Downloading and verifying
            {state.percent === null ? "…" : ` ${state.percent}%`}
          </span>
        ) : null}
        {state.kind === "ready" ? (
          <span>Installed. Restart the app to use the new version.</span>
        ) : null}
        {state.kind === "unsupported" ? (
          <span style={{ color: "var(--text-muted)" }}>
            Updates install from the desktop app, not this browser preview.
          </span>
        ) : null}
        {state.kind === "error" ? (
          <span style={{ color: "var(--tone-red-ink)" }}>{state.message}</span>
        ) : null}
      </div>
    </div>
  );
}
