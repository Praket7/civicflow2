import fs from "node:fs";
import path from "node:path";

const appBinary = path.resolve("src-tauri/target/debug/civicflow");

// The native suite runs against a throwaway workspace. Pointing the app at this
// directory is preferable to deleting the real app-data folder, which holds the
// user's own demo work.
const dataDir = path.resolve(".wdio-data");
process.env.CIVICFLOW_DATA_DIR = dataDir;
// A throwaway workspace gets a throwaway key. Without this the suite would ask
// the machine's credential store for the key that protects the real install.
process.env.CIVICFLOW_WORKSPACE_KEY = "0".repeat(64);

// The webview store is shared with the installed app, so the suite must not
// delete it: doing so signs the real app out and can erase a sign-in hand-off
// that was in flight while the tests ran. A fresh database is enough to keep
// the "no session" assertion honest — a token from the old run no longer
// resolves, so the app still lands on the sign-in screen.

export const config = {
  runner: "local",
  specs: ["./tests/e2e/**/*.spec.mjs"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: appBinary,
      },
    },
  ],
  services: [
    [
      "@wdio/tauri-service",
      {
        driverProvider: "embedded",
        appBinaryPath: appBinary,
        // The app's own stderr is the only place a Rust panic shows up.
        captureBackendLogs: true,
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    // Every element lookup and click waits out the driver's 5s window-state
    // probe, which never answers in this app. The longest flow — create an
    // account, answer setup, sign out, sign back in — runs a hundred of those
    // probes, and the debug build's Argon2 hashing adds tens of seconds to
    // each password write, so it needs more than several minutes of its own.
    timeout: 1_500_000,
  },
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  onPrepare() {
    fs.rmSync(dataDir, { recursive: true, force: true });
  },
};
