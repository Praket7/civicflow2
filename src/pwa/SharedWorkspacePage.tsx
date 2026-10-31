import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, Cloud, CloudOff } from "lucide-react";
import { isTauri } from "../lib/platform";
import { cloudEmail, cloudSession, onCloudSessionChange } from "../lib/cloud/client";
import { READY_MESSAGE, sendSession } from "../lib/cloud/bridge";

/**
 * The hosted workspace, opened from the desktop.
 *
 * The cloud client is its own document (`pwa.html`), not a set of routes inside
 * this one: it already owns a router, a replica and a service worker, and two
 * routers in one React tree is not something React Router allows. The frame
 * keeps that client exactly as the phone and browser get it.
 *
 * The session is passed down after the frame says it is ready, because the
 * desktop already holds it in the operating system credential store and a
 * second sign-in would be a second refresh token on disk. A refresh in the
 * parent is forwarded too, so the framed client keeps working past the access
 * token's lifetime.
 */
export function SharedWorkspacePage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;

    function show(session: Session | null) {
      setEmail(session ? cloudEmail(session) : null);
      setChecked(true);
      sendSession(frame.current, session);
    }

    async function read() {
      const session = await cloudSession();
      if (active) show(session);
    }

    void read();
    const unsubscribe = onCloudSessionChange((session) => {
      if (active) show(session);
    });

    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string } | null;
      if (data?.type === READY_MESSAGE) void read();
    }
    window.addEventListener("message", receive);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("message", receive);
    };
  }, []);

  const settingsHref = isTauri() ? "#/coordinator/settings" : "/coordinator/settings";

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <h1
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
        }}
      >
        Shared workspace
      </h1>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "6px 14px",
          borderBottom: "1px solid var(--border-soft)",
          background: "var(--surface-sunken)",
          fontSize: 12.5,
          flexWrap: "wrap",
        }}
      >
        <a
          href={settingsHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-muted)",
            textDecoration: "none",
          }}
        >
          <ArrowLeft aria-hidden size={14} />
          Local workspace
        </a>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-muted)",
          }}
        >
          <Cloud aria-hidden size={13} />
          Hosted workspace · offline changes stay on this device until it reconnects
        </span>
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-muted)",
          }}
        >
          {email ? (
            `Signed in as ${email}`
          ) : checked ? (
            <>
              <CloudOff aria-hidden size={13} />
              <a href={settingsHref} style={{ color: "inherit" }}>
                Not signed in — connect under Settings
              </a>
            </>
          ) : (
            "Checking the shared workspace…"
          )}
        </span>
      </div>
      <iframe
        ref={frame}
        src="pwa.html#/"
        title="CivicFlow shared workspace"
        style={{ flex: 1, width: "100%", border: 0 }}
      />
    </div>
  );
}
