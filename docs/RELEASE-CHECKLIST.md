# Release checklist

This is the manual half of a release. The automated gates run on every push; the table below is
the part a fresh machine has to prove. Record the date and the person who ran each row, and keep
the installer hashes with the results.

## Current status

| Item                             | Status                                                                |
| -------------------------------- | --------------------------------------------------------------------- |
| Code, tests, and automated gates | Green on `main`                                                       |
| Packaged installers              | Not built yet; no `v*` tag has been pushed                            |
| Clean-install matrix             | Not run — no disposable Windows or Linux machine is available         |
| macOS Gatekeeper path            | Documented in the README; not yet exercised on a quarantined download |
| Updater round trip               | Not run; needs a published `v0.1.1` before `v0.1.2` can find it       |

The clean-install matrix is deliberately left unchecked. Do not mark it complete from a developer
machine that already has the toolchain, a warm WebView cache, and the repository checked out.

## Automated evidence

Run these before tagging. The latest green run is linked from the repository's Actions tab.

| Gate                                             | What it proves                                                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend checks                                  | Typecheck, lint, formatting, copy and i18n checks, hardcode and identity scans, generated-file drift, help coverage, documentation facts, unit tests, SQL protocol tests, and the web build  |
| Print, accessibility-tree, zoom, contrast audits | Every registered route renders a heading, named controls, no horizontal overflow at 200 percent, and AA contrast in both themes                                                              |
| Rust checks                                      | `cargo fmt --check`, `cargo clippy -D warnings`, the core test suite, and a desktop shell compile                                                                                            |
| Native end-to-end (macOS)                        | A real Tauri window opens signed out, opens the offline demo workspace, refuses the wrong role in both directions, signs in as a volunteer, and creates and signs in a new volunteer account |
| Secret scan                                      | `gitleaks` finds no credential in the working tree                                                                                                                                           |
| Dependency audit                                 | Rust advisory checks in both Cargo workspaces and `pnpm audit --prod` at high severity                                                                                                       |

## Clean-install matrix

Use a fresh OS install or a disposable VM for each column. Download through a browser so the
platform's quarantine or Mark-of-the-Web applies.

| Check                                                                                                  | macOS | Windows 11 | Ubuntu 24.04 |
| ------------------------------------------------------------------------------------------------------ | ----- | ---------- | ------------ |
| Download the installer from the release page and verify `SHA256SUMS.txt`                               | ☐     | ☐          | ☐            |
| Get past Gatekeeper / SmartScreen / AppImage permissions                                               | ☐     | ☐          | ☐            |
| First launch opens the offline demo workspace with Wi-Fi off                                           | ☐     | ☐          | ☐            |
| Build and apply an AutoRoster plan                                                                     | ☐     | ☐          | ☐            |
| Run the check-in kiosk and record a manual check-in                                                    | ☐     | ☐          | ☐            |
| Export a PDF report and a CSV                                                                          | ☐     | ☐          | ☐            |
| Create a backup, change data, restore the backup                                                       | ☐     | ☐          | ☐            |
| Quit, relaunch, and confirm the data is still there                                                    | ☐     | ☐          | ☐            |
| Sign in to the shared workspace (proves the anon key was baked in)                                     | ☐     | ☐          | ☐            |
| Install `v0.1.1`, then install `v0.1.2` from Settings → Updates; confirm data and keychain key survive | ☐     | ☐          | ☐            |

Record results here:

| Date | Platform | Installer / SHA-256 | Result | Notes |
| ---- | -------- | ------------------- | ------ | ----- |
|      |          |                     |        |       |

## Before the first tag

1. Rotate the three `@civicflow.test` fixture passwords and revoke their sessions. The old
   password is still readable in earlier public commits, so deleting it from `main` is not
   enough. Keep the new values in a password manager, never in the repository.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as repository secrets if reminder dispatch
   should run. Without them the scheduled job reports a notice and skips; push deliveries stay
   queued.
3. Confirm `gh secret list` shows the two Tauri signing secrets and nothing unexpected.
4. Confirm the bundle identifier is `io.github.praket7.civicflow`, so the app-data directory and
   keychain entry do not move after the first release.
5. Run the full `pnpm verify` locally once more, then confirm the CI run on the tagged commit is
   green.
6. Tag a release candidate (`v0.1.1-rc.1`) first. A hyphen makes the workflow mark it as a
   prerelease, so it never becomes `latest` and never feeds the updater.
7. Run the matrix against the release-candidate assets. Fix what it finds, then tag `v0.1.1`.
8. Install `v0.1.1`, tag a trivial `v0.1.2`, and complete the updater round trip.

## Release sequence

- ☐ `pnpm verify` is green on `main`
- ☐ CI is green on the commit being tagged
- ☐ `node scripts/check-release-version.mjs vX.Y.Z` passes
- ☐ Release-candidate installers and checksums downloaded and verified
- ☐ Clean-install matrix completed on all three platforms
- ☐ Updater round trip completed
- ☐ Release notes contain no demo passwords and no real organization details
- ☐ Final tag pushed and the release marked non-prerelease

## Known constraints

- macOS builds are ad-hoc signed, not notarized. Gatekeeper blocks a quarantined download until
  the user chooses **Open Anyway**; the README documents both that and the `xattr` command.
- Windows and Linux installers are unsigned. SmartScreen warns on Windows; Linux has no
  equivalent gate.
- Kiosk mode is a route in the main window, not an OS-level kiosk.
- The desktop and the volunteer PWA share the hosted workspace. Scheduling, participation,
  volunteer records, reports, conflicts, and roster plans have native shared screens. The
  shared report reads the replica, exports CSV, and prints a funder packet. AutoRoster still
  runs over the local SQLite workspace, and local reports travel as exports.
