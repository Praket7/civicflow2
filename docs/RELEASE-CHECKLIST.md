# Release checklist

Use this for every tagged release. The release workflow re-runs verification on the tagged
commit, and `.github/workflows/ci.yml` covers changes on `main`. This checklist covers the manual
checks and packaging steps that CI cannot prove.

## Prerequisites

- A clean checkout of the exact commit to release, with no untracked secrets.
- The Node version in `.node-version`, pnpm 12.9.1, stable Rust, and the platform's Tauri
  prerequisites.
- `pnpm install --frozen-lockfile` completes without changing the lockfile.
- The signing and updater secrets are configured for the repository, or the release is explicitly
  marked unsigned in its notes.

## Version and automated gate

1. Bump the version in all four manifests together: `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, and `src-tauri/core/Cargo.toml`.
2. Run the exact-tag check. The tag must match the manifest version; prerelease tags must use the
   same prerelease version in every manifest.

   ```bash
   node scripts/check-release-version.mjs vX.Y.Z
   ```

3. Run the full local gate:

   ```bash
   pnpm verify
   cargo check --manifest-path src-tauri/Cargo.toml
   pnpm audit --prod --audit-level=high
   gitleaks dir . --no-banner --redact --config .gitleaks.toml
   ```

4. Confirm the CI run for the exact commit is green. Do not tag a different SHA.

## Build installers

Build on each target platform, or tag the commit and let the release workflow build the matrix.
The workflow produces one universal macOS DMG (Apple silicon and Intel), Windows x64, and Linux x64
installers, plus the signed updater feed, `SHA256SUMS.txt`, and GitHub build provenance attestations.

For a local macOS build:

```bash
pnpm build:web
pnpm tauri build --target universal-apple-darwin --bundles dmg
```

## Clean-install matrix

Use a fresh OS install or a disposable VM for each column. Download through a browser so
quarantine or Mark-of-the-Web applies.

| Check                                                                                                 | macOS | Windows 11 | Ubuntu 24.04 |
| ----------------------------------------------------------------------------------------------------- | ----- | ---------- | ------------ |
| Verify `SHA256SUMS.txt` before opening the installer                                                  | ☐     | ☐          | ☐            |
| Complete Gatekeeper, SmartScreen, or AppImage permission flow                                         | ☐     | ☐          | ☐            |
| Launch with the network off and open the demo workspace                                               | ☐     | ☐          | ☐            |
| Build and apply an AutoRoster plan                                                                    | ☐     | ☐          | ☐            |
| Check in a volunteer and record a no-show                                                             | ☐     | ☐          | ☐            |
| Approve service hours and export a CSV and PDF report                                                 | ☐     | ☐          | ☐            |
| Create a backup, change data, and restore the backup                                                  | ☐     | ☐          | ☐            |
| Quit, relaunch, and confirm the data persisted                                                        | ☐     | ☐          | ☐            |
| Sign in to the shared workspace                                                                       | ☐     | ☐          | ☐            |
| Install the previous release, update to this release, and confirm data and the keychain entry survive | ☐     | ☐          | ☐            |

Do not mark a row complete from a developer machine or from an earlier build. Record the actual
release-candidate result, and do not claim notarization or signing that was not performed.

## Signing constraints

- Without an Apple Developer ID certificate and notarization credentials, macOS builds are
  ad-hoc signed and Gatekeeper will reject them on a quarantined download. Publish the Open Anyway
  instructions with the release; do not imply the artifact is notarized.
- Without a Windows code-signing certificate, SmartScreen warns about the installer. Publish that
  limitation explicitly and rely on SHA-256 checksums plus GitHub build provenance, not a
  self-signed certificate.
- Linux AppImages need the executable bit; the deb and rpm use WebKitGTK 4.1.
- The updater requires `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
  Losing either half prevents installed builds from updating.

## Tag and publish

1. For a release candidate, bump all four manifests to `X.Y.Z-rc.N`, run the checks, and tag
   `vX.Y.Z-rc.N`. A hyphen makes the GitHub release a prerelease, so it never becomes `latest`
   or feeds the updater.
2. Run the clean-install matrix against the candidate assets. Fix defects and repeat the
   candidate build if necessary.
3. Bump all four manifests to `X.Y.Z`, rerun the local gate and CI, and tag `vX.Y.Z`.
4. Verify the release contains the universal macOS DMG, Windows and Linux x64 installers,
   `SHA256SUMS.txt`, the updater feed, and GitHub build provenance attestations.
5. Install the published release, then install the next patch release from **Settings → Updates**
   and complete the updater round trip.
