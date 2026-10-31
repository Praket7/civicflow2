import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "@fontsource-variable/geist";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/geist-mono";
import "../styles/global.css";
import { awaitSessionFromParent, isEmbedded } from "../lib/cloud/bridge";
import { CloudProvider } from "../lib/sync/provider";
import { adoptBridgedSession, supabase } from "../lib/sync/auth";
import { PwaApp } from "./PwaApp";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("CivicFlow root element is missing");

/**
 * Inside the desktop window the session comes from the parent frame, which
 * keeps it in the operating system credential store. The page is rendered only
 * after the handshake, so the first read already sees the signed-in user.
 */
async function adoptDesktopSession(): Promise<void> {
  if (!isEmbedded()) return;
  const session = await awaitSessionFromParent();
  adoptBridgedSession(session);
  if (!session) return;
  try {
    const { error } = await supabase().auth.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    });
    if (error) adoptBridgedSession(null);
  } catch {
    // A frame without the provider configuration still renders its own
    // sign-in; nothing here should stop the page from appearing.
    adoptBridgedSession(null);
  }
}

void adoptDesktopSession().finally(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <HashRouter>
        <CloudProvider>
          <PwaApp />
        </CloudProvider>
      </HashRouter>
    </StrictMode>,
  );
});

/**
 * A service worker is an upgrade path, not a cache trick. It is skipped on
 * insecure origins where the browser would refuse registration anyway.
 */
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // A waiting worker is a new version. Activate it only when this page is
        // hidden, so an in-flight form or scan is never swapped mid-edit.
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              document.addEventListener(
                "visibilitychange",
                () => {
                  if (document.visibilityState === "hidden")
                    worker.postMessage({ type: "SKIP_WAITING" });
                },
                { once: true },
              );
            }
          });
        });
      })
      .catch(() => {
        // Offline support is a bonus; the app still works without it.
      });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}
