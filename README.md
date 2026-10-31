# CivicFlow

CivicFlow is a volunteer coordination app for small nonprofits. Coordinators plan shifts,
staff open roles, run the check-in desk, review hours, and report outcomes. Volunteers find
service, register, check in, and keep a record of what they contributed.

The desktop app runs on a local SQLite database. Scheduling, reporting, check-in, and
AutoRoster work without a network connection. Accounts and organization membership are
enforced by the Rust core, not by hiding screens in the browser.

The volunteer PWA is a separate entry point backed by Supabase. It keeps a small replica,
queues writes, and reconciles through a command log. The hosted workspace is the authority
for anything shared across devices. The desktop can open that same hosted workspace in its own
window — one replica, the same command authority — while keeping its local SQLite workspace one
click away. Deployment and the remaining gaps are covered in **Cloud workspace** below.

<!-- CIVICFLOW_FACTS_START -->
| Fact | Value |
| --- | --- |
| Package version | `0.1.1` |
| Registered routes | 50 |
| Migration files | 14 |
| Database schema | v14 |
| Application tables | 47 |
<!-- CIVICFLOW_FACTS_END -->

## Product

The coordinator workspace has six primary areas:

- **Home** answers what needs attention now. It shows the next shift, a weekly staffing
  summary, AutoRoster coverage, and one queue for coverage gaps, hours waiting for review,
  applications, and expiring credentials.
- **AutoRoster** builds a staffing plan for the next seven days. Every assignment can be
  explained, compared with an alternative, and reviewed before it is written.
- **Schedule** holds the calendar, shift rosters, attendance, and the check-in kiosk.
- **Opportunities** holds programs, their shifts, roles, and capacity.
- **People** groups volunteers, applications, credentials, hours review, and service records.
  Each is a tab inside one work area rather than a separate destination.
- **Reports** groups the report library, impact analytics, engagement signals, the custom
  builder, and the printable impact report.

Settings, the audit log, backups, accessibility, help, and photo credits live in the workspace
menu so they do not compete with daily work.

Volunteer navigation is five areas: Home, Discover, Schedule, Hours and Impact, and Profile.
Saved opportunities are a tab inside Discover. Verification is a tab inside Hours and Impact.
Notifications stay in the top bar.

Every screen is still reachable from the command palette (`Cmd/Ctrl+K`). Search covers every
registered route and the main coordinator actions, so an experienced user does not have to
walk through the six areas.

### Core journeys

1. Create an organization, add an opportunity, invite a volunteer, and publish a shift.
2. Open Home, see the staffing gaps, run AutoRoster for the week, review the evidence, and
   apply the plan.
3. Run an event: open the next shift, launch the kiosk, check people in, and record no-shows.
4. Find a volunteer: search People, open a profile, check credentials, and look at upcoming
   assignments.
5. Report impact: choose a period, preview the result, and export a PDF or CSV.

## Architecture

```text
Desktop                                  Volunteer PWA
React 19 + TypeScript + Vite             React 19 + Dexie
        |                                        |
        v                                        v
WorkspaceRepository                      outbox + replica
        |                                        |
        v                                        v
Tauri commands                           Supabase RPC
        |                                        |
        v                                        v
civicflow-core (Rust)                    Postgres
        |                                        |
        v                                        v
SQLite workspace                         change log + commands
```

- `src-tauri/core` is an independent crate. It owns the schema, migrations, seeded demo data,
  authorization, workflow rules, matching, reporting, backups, and audit events. It has no Tauri
  dependency and is tested with `cargo test`.
- `src-tauri/src/lib.rs` exposes thin Tauri commands. Each command resolves the session token
  through the core before it reads or writes workspace data.
- `src/lib/workspace/repository.ts` is the single boundary between React and the native
  commands. `previewRepository.ts` implements the same contract in the browser with the shared
  demo data. The desktop build never selects the preview repository.
- React reads one snapshot from the core. `src/lib/workspace/selectors.ts` derives display
  values from that snapshot. Screens do not keep private copies of workspace records.
- The database applies migrations in order and records each version in `schema_migrations`.
  Backups check the application id, schema version, foreign keys, and table set before restore.

### Local first

Writes go to local SQLite first and the UI refreshes from the returned snapshot. Nothing on a
normal screen waits for a network request. Hosted sign-in is optional and only used to prove an
identity. The workspace itself remains on the device.

## Cloud workspace

The hosted workspace is Postgres, not a copy of the SQLite schema. It stores profiles,
organizations, memberships, volunteers, opportunities, shifts, registrations, attendance,
hours, notifications and deliveries. `supabase/migrations` is the source of truth for a fresh
project. Apply the files in filename order.

The hosted project already has every object. Its migration history only records the three
reminder migrations because the earlier ones were applied directly while the schema was being
built. Do not run `db push` against that project expecting a clean replay. `pnpm test:sql`
applies the whole set to a real Postgres in PGlite and exercises RLS, commands, sync, check-in
and reminders without Docker.

Two Edge Functions sit in front of the database:

| Function | Auth | Purpose |
| --- | --- | --- |
| `dispatch-reminders` | Service role for dispatch, any project key for `?action=config` | Generates due reminders, claims deliveries, sends push |
| `push-setup` | Signed-in user | Returns the VAPID public key and records a browser push subscription |

Deploy both after a schema change with
`supabase functions deploy <slug> --project-ref imzdblvljdcbnxtwbmbw`. Push is the only outbound
channel; email and SMS are not part of this build. `?action=config` always reports both as
unavailable, and a delivery queued for one of them is closed as skipped rather than failed.
`VAPID_SUBJECT` sets the push contact. VAPID keys are generated on the first push and stored in
the database, so no key belongs in the app bundle.

The database does not schedule anything on its own. `.github/workflows/reminders.yml` calls the
dispatcher every fifteen minutes and needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as
repository secrets. Without them the job fails loudly instead of pretending a reminder was
sent. pg_cron is not enabled on this project; if it is enabled later, `pg_net` can call the same
endpoint with the service key held in Vault.

The PWA is a separate entry point, `pwa.html`. Serve it over HTTPS, or from `localhost`, so the
service worker and push registration are allowed. It reads `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. Never put the service role key in the frontend environment.

The test organization, Buffalo Community Pantry, has three accounts that all use the password
`Volunteer!2026`: `maya.volunteer@civicflow.test`, `alice.volunteer@civicflow.test` and
`jordan.coordinator@civicflow.test`. The coordinator opens `pwa.html#/coordinator` for device
and delivery health. Rotate or remove these accounts before a real organization uses the
project.

The dispatcher has run against the hosted project and recorded a successful `reminders` job.
In-app delivery is proven end to end. Push has its VAPID keys stored and reports configured; a
device still has to grant notification permission and subscribe. Email and SMS were removed:
the dispatcher has one outbound adapter, web push. Camera check-in has unit coverage and a
manual-code fallback; it has not been run on a physical iPhone or Android device.

### The desktop as a peer

**Settings → Shared workspace** connects the desktop to the hosted project. The session is
written to the operating system credential store through `keyring`, never to the webview's local
storage, and the device registers itself so the coordinator health view can tell machines apart.

**Open shared workspace** mounts the hosted client inside the desktop window. It uses the same
replica, the same offline outbox and the same command authority as the phone app, so a
registration made in the window reaches the server the same way a phone's does. A coordinator
who signs in there sees device and delivery health; a volunteer sees their own app.

The frame does not ask for a password of its own. It announces itself, the desktop answers with
the session it already holds, and the framed client adopts it with memory-only storage, so one
sign-in covers both surfaces and only the credential store keeps a refresh token. Token
refreshes in the desktop are forwarded, and a signed-out desktop tells the frame so it can show
its own sign-in instead of a blank window.

Two things stay local on purpose. AutoRoster and reporting are Rust code over the local SQLite
workspace, and the hosted coordinator view is health and delivery, not a full roster editor.
Planning, rosters and reports therefore run on the local workspace and travel as exports, until
the planner has a server-side home.

**Records → Backups** writes a sealed archive anywhere the coordinator chooses. The snapshot is
encrypted with a passphrase (Argon2id, then XChaCha20-Poly1305) and the plaintext copy is deleted
before the command returns. Restoring from an archive goes through the same validation as a
local snapshot, so a file that was truncated in transit cannot replace the workspace.

### At rest

The workspace database is SQLCipher ciphertext from the first write. A 32-byte key is generated
once per machine, kept in the OS credential store beside the shared-workspace session, and
never written into the project, the page, or a log. Without it a copy of `civicflow.db` does not
even reveal its schema; `src-tauri/core/tests/encryption.rs` asserts that with a plain
`rusqlite` connection.

An installation that predates encryption is rewritten on the next launch: the plaintext file is
exported into an encrypted copy beside it, the copy is checked, and only then is it swapped in.
Snapshots taken through the SQLite backup API inherit the encryption, so the backup directory
holds no readable copies either. **Records → Backups** archives are sealed a second time with
the coordinator's passphrase, which is what makes them safe to carry off the machine.

Losing the credential-store entry loses the workspace. Keep a sealed archive of anything that
matters; restoring it needs only the passphrase. The native test suite sets
`CIVICFLOW_WORKSPACE_KEY` (64 hex characters) so a run never reads or writes the key on the
machine; that variable is a test escape hatch, not a supported way to run the app.

The updater is wired and signed. `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are set on the `Praket7/civicflow2` repository. The feed has
not been exercised against a published release because no `v*` tag has been pushed yet.

### Connecting providers

Every value below goes to the place named here, never into a commit and never into a
frontend bundle except the publishable key. Do not paste a service role key or a provider secret
into a chat or an issue: create it in the provider's dashboard and run the command yourself, or
write it to a gitignored file in the project and name the file.

1. **Publishable key.** In the Supabase dashboard open **Project Settings → API** and copy
   **Project URL** and the **publishable / anon** key. Put both in `.env`:
   `VITE_SUPABASE_URL=https://<ref>.supabase.co` and `VITE_SUPABASE_ANON_KEY=<publishable key>`.
   Add the same two values as repository secrets so release builds include them:
   `gh secret set VITE_SUPABASE_ANON_KEY -R Praket7/civicflow2`, then paste the key at the
   prompt, and the same for `VITE_SUPABASE_URL`. Set one value per command; piping `.env` into a
   secret would upload whichever line came first. `.env` is gitignored.
2. **Service role.** Supabase **Project Settings → API → service_role**. Set it as
   `SUPABASE_SERVICE_ROLE_KEY`, with `SUPABASE_URL`, as repository secrets for
   `.github/workflows/reminders.yml` and for nothing else. This key bypasses row-level security,
   so it never enters `.env`, the app bundle, or a message. The reminder workflow fails loudly
   when either secret is missing.
3. **Deploy the functions** after any change:
   `supabase functions deploy dispatch-reminders --project-ref <ref>` and the same for
   `push-setup`. Both read the project URL and service key from the platform.
4. **Email and SMS.** Nothing to configure, because neither ships. Reminders reach a volunteer
   as an in-app notification and as a browser push. Any `RESEND_*`, `GMAIL_*`, `EMAIL_*` or
   `TWILIO_*` secret left on the project is inert and can be deleted from the dashboard.
5. **Push.** Nothing to paste. VAPID keys are generated on the first dispatch and stored in the
   database. `VAPID_SUBJECT` optionally sets the contact.
7. **Update signing.** `TAURI_SIGNING_PRIVATE_KEY` holds the literal contents of
   `.secrets/updater/civicflow-updater.key`, not its path. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   holds the password beside it. Both are already set on `Praket7/civicflow2` and both files are
   gitignored. Rotating them requires a manual release with the new public key in
   `src-tauri/tauri.conf.json`.
8. **Check the wiring** without sending anything:
   `curl "$SUPABASE_URL/functions/v1/dispatch-reminders?action=config" -H "apikey: $ANON_KEY"`
   reports which channels are configured. Then open **Settings → Reminders** and send a test.

### Demo mode

A fresh installation starts empty. The demo workspace is created only when someone chooses
**Explore the demo** on the welcome screen. Demo records live in `shared/demo-workspace.json`
and are loaded by both the Rust seeder and the browser preview. A demo organization is marked
with `is_demo`, and the workspace clock is fixed for authored demo dates. Production
workspaces use the system clock and the organization timezone.

## Organization and access

An account proves an identity. Access comes from an organization membership row.

Roles are `owner`, `coordinator`, and `volunteer`. A person can be an owner in one
organization, a coordinator in another, and a volunteer in a third. There is no global
coordinator role and no role stored in hosted-auth metadata.

Membership rules:

- The first person to create an organization becomes its owner.
- An owner can invite coordinators and volunteers, change roles, disable a membership, and
  transfer ownership.
- A coordinator can run operations and invite volunteers when policy allows.
- An organization always keeps at least one active owner. The last owner cannot be removed,
  demoted, or disabled.
- Invitations are one-time, expiring, revocable, and bound to a role. Tokens are stored hashed.
- Every role or status change increments `membership_epoch`. A queued privileged operation
  created under an older epoch is rejected when it reaches the authority.

The organization switcher changes the active membership, not the account role. A person with
no membership can only reach the create-or-join screens.

## AutoRoster

AutoRoster is a deterministic min-cost flow solver in `src-tauri/core/src/matching.rs`. React
does not score candidates or decide eligibility. The core returns the plan together with every
candidate evaluation, score component, hard check, and selection reason. The screen formats
those values.

The default scope is the next seven days across every shift with a required-role gap. A
single-shift review remains available. The engine respects:

- required skill and credential validity through the shift date;
- stated availability;
- overlapping assignments;
- daily and weekly shift limits;
- assignment locks;
- waitlist membership and capacity.

A plan carries its base workspace revision and policy version. Applying checks both again and
returns `PLAN_STALE` rather than writing a plan that another change invalidated. A reviewed
plan is applied in one SQLite transaction. Every assignment is rechecked, each assignment gets
an audit event, and the plan gets one summary event. If any assignment fails, the batch rolls
back.

The explanation model is contrastive. Each proposed person has **Why this person?**, and other
eligible people can be asked about with **Why not?**. The answer lists failed hard checks or
shows what forcing that person into the seat would do to the rest of the plan.

Coverage recovery uses the same solver and the same explanation model. It is not a separate
scoring system.

## Data model

The schema is defined by the numbered migrations in `src-tauri/core/migrations`. All migrations
are additive and idempotent on upgrade. Foreign keys are enabled.

The main records are:

- organizations, memberships, invitations, contacts, and updates;
- accounts, sessions, auth attempts, and hosted handoffs;
- volunteers, skills, availability rules, and credentials;
- opportunities, shifts, shift roles, role requirements, and shift series;
- registrations, waitlist entries, attendance events, and the attendance ledger;
- hour entries, service verifications, and impact results;
- notifications, notification rules, activity events, audit events, and saved views;
- roster policies, assignment locks, workspace revisions, sync conflicts, and replica metadata;
- backups and schema migration bookkeeping.

Counts shown to people are derived from registrations, attendance events, and approved hour
records. The shift's cached `confirmed` or role `filled` values are materialized inside the
transaction that changes the underlying rows, not treated as independent truth.

The desktop build stores each organization as a separate local workspace. Each organization
in the switcher has its own membership and profile, and the domain snapshot is loaded through
the active membership.

The hosted organization uses the same nouns but different storage: profiles, memberships,
volunteers, opportunities, shifts, registrations, attendance, hours, notifications and
deliveries live in Postgres. `supabase/migrations` is the source of truth. The PWA never
writes a row directly; it submits a command, and the server decides whether the organization's
rules and the caller's role allow it.

## Security

- Passwords use Argon2id. Session tokens are random, stored hashed, and expire.
- Every Tauri command that touches workspace data calls `require_user` first. Coordinator-only
  commands call `require_coordinator`. A volunteer command that names a volunteer checks the
  membership between the account and that volunteer.
- Volunteer snapshots are redacted before they cross the IPC bridge. A volunteer receives
  their own profile, registrations, hours, credentials, and notifications, not the coordinator
  directory or the audit log.
- Hosted identity is accepted only after Supabase verifies the user. The app then opens or
  creates the matching local account. Hosted metadata never grants a workspace role.
- Invitation tokens are random, hashed at rest, single-use, and expire. Reusable coordinator
  codes do not exist.
- The content security policy, capability file, deep-link handling, and URL allowlist are in
  `src-tauri/tauri.conf.json` and `src-tauri/capabilities/default.json`.
- Reports and exports are generated in Rust and written through the native save dialog. The
  browser never receives a filesystem path.
- The shared-workspace session is stored with the OS credential store, not in page storage. A
  webview script cannot read another origin's keychain entry.
- Encrypted archives are sealed with a key derived from the coordinator's passphrase. The
  archive header is authenticated, so a changed cost parameter fails the same way a changed
  byte does.

## Accessibility

- Semantic landmarks, one `h1` per screen, a skip link, visible focus, and labeled controls.
- Status is never carried by color alone. Charts have a table alternative.
- Reduced motion, high contrast, text scaling, underlined links, and right-to-left layout are
  supported.
- The automated accessibility tree audit visits every registered route and requires names on
  every interactive control. The zoom audit renders at 200 percent and fails on horizontal
  overflow or a missing heading. The contrast audit checks both themes.
- A human VoiceOver or NVDA pass on a packaged build is still on the release checklist.

## Testing

```bash
pnpm verify          # typecheck, lint, format, copy, hardcodes, generated data, tests, build,
                     # browser audits, Rust fmt, clippy, and cargo test
pnpm test            # frontend tests
pnpm test:sql        # every Supabase migration, RLS, commands, sync and reminders in PGlite
cargo test --manifest-path src-tauri/core/Cargo.toml
pnpm test:native     # WebdriverIO against the built macOS app
```

The frontend suite covers the route registry, accessibility on every screen, selectors,
coverage maths, preview repository behavior, hosted identity parsing, print styles, and the
Ask CivicFlow matcher. The Rust suite covers migrations, foreign keys, accounts, membership
and invitations, ownership invariants, role refusal, snapshot redaction, registrations,
waitlists, attendance, hours, credentials, recurrence, recovery, reports, exports, AutoRoster
against a brute-force oracle, plan staleness, and backup restore.

Generated checks:

- `pnpm check:generated` rebuilds the demo data and translation catalog and fails on drift.
- `pnpm check:hardcodes` rejects fixture ids and ISO dates in production code.
- `pnpm docs:check` verifies README links and generated facts.
- `pnpm db:verify` opens the live desktop database read-only and reports integrity, schema
  version, foreign keys, and record counts.

## Build and run

```bash
pnpm install
pnpm dev              # desktop preview at http://localhost:5173
pnpm dev              # volunteer PWA at http://localhost:5173/pwa.html
pnpm tauri dev        # native desktop window
pnpm tauri build      # installers for the current platform
pnpm docs:update      # refresh the generated facts block
```

Demo accounts after choosing **Explore the demo**:

- `praket@feedmorewny.org` / `civicflow-demo` (coordinator)
- `maya.chen@gmail.com` / `civicflow-demo` (volunteer)

Hosted sign-in is optional for the desktop. Set `VITE_SUPABASE_ANON_KEY` to enable Google and
email links. The project address is fixed in `src/lib/auth/hosted.ts` and
`src/lib/sync/config.ts`, and the desktop content-security policy allows exactly that origin,
so moving to another Supabase project means changing all three. Without the key the desktop
makes no hosted-auth request and the PWA cannot sign in.

Deploying the functions, setting their secrets, scheduling the reminder dispatcher and the
test accounts are covered in **Cloud workspace** above.

### Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`. It builds macOS (Apple silicon and
Intel), Windows x64, and Linux x64 installers, attaches them to the GitHub release, publishes
SHA-256 checksums, and writes the signed updater feed at
`releases/latest/download/latest.json`. The app checks that feed from Settings → Updates and
installs only a package signed by the matching private key.

Unsigned macOS builds are ad-hoc signed so Gatekeeper offers **Open Anyway** instead of
reporting a damaged app. Windows builds without a certificate are unsigned, so SmartScreen
offers **More info** then **Run anyway**.

Signing secrets, when available, are repository secrets:

| Secret                         | Platform | Purpose                                  |
| ------------------------------ | -------- | ---------------------------------------- |
| `APPLE_CERTIFICATE`            | macOS    | Base64 Developer ID Application `.p12`   |
| `APPLE_CERTIFICATE_PASSWORD`   | macOS    | Password for the exported certificate    |
| `APPLE_ID`                     | macOS    | Apple ID for notarization                |
| `APPLE_PASSWORD`               | macOS    | App-specific password                    |
| `APPLE_TEAM_ID`                | macOS    | Apple Developer team id                  |
| `APPLE_API_KEY`                | macOS    | Alternate App Store Connect key id       |
| `APPLE_API_ISSUER`             | macOS    | Alternate issuer id                      |
| `APPLE_API_KEY_CONTENT`        | macOS    | Base64 `.p8` key                         |
| `WINDOWS_CERTIFICATE`          | Windows  | Base64 code-signing `.pfx`               |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows  | Password for the `.pfx`                  |
| `WINDOWS_TIMESTAMP_URL`        | Windows  | Optional RFC 3161 timestamp service      |
| `TAURI_SIGNING_PRIVATE_KEY`    | Releases | Literal contents of the updater key     |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Releases | Password for the updater key       |

Use either the Apple ID trio or the API key trio. Never commit a certificate or password.

A local updater keypair was generated at `.secrets/updater/` (ignored by git). Move the private
key and its password into the two `TAURI_SIGNING_*` repository secrets before tagging a release.
The public key is in `src-tauri/tauri.conf.json`. Losing either half means installed builds
cannot be updated; a new keypair must then be shipped in a manual release. The endpoint assumes
the release repository is `Praket7/civicflow2`; change both the endpoint and the public key if
the repository moves.

## Credits

All bundled photography is free-licensed. Images were cropped and resized for layout. The
impact skyline is color-graded and scrimmed. Those changes do not alter the license.

| Asset                                                                      | Creator / source                                     | License       |
| -------------------------------------------------------------------------- | ---------------------------------------------------- | ------------- |
| `hero-community.jpg`, `opp-food-distribution.jpg`, `community-strip-1.jpg` | Pexels 6646918                                       | Pexels        |
| `opp-pantry.jpg`                                                           | Pexels 6646862                                       | Pexels        |
| `opp-community-garden.jpg`, `community-strip-3.jpg`                        | Pexels 39779034                                      | Pexels        |
| `opp-library-tutoring.jpg`, `community-strip-2.jpg`                        | Pexels 8342411                                       | Pexels        |
| `opp-park-cleanup.jpg`                                                     | Pexels 39037905                                      | Pexels        |
| `opp-animal-shelter.jpg`                                                   | Pexels 35231854                                      | Pexels        |
| `opp-senior-meals.jpg`                                                     | Pexels 6647037                                       | Pexels        |
| `welcome-volunteer.jpg`                                                    | Pexels 6646930                                       | Pexels        |
| `signin-volunteers.jpg`                                                    | Pexels 6995298                                       | Pexels        |
| `opp-community-event.jpg`                                                  | Irvin Parco Sto. Tomas, Wikimedia Commons            | CC BY-SA 4.0  |
| `buffalo-skyline.jpg`                                                      | Peter S, Wikimedia Commons                           | CC BY-SA 4.0  |
| `volunteers/olive-carter.jpg`                                              | Pexels 40062802                                      | Pexels        |
| `volunteers/rafael-martin.jpg`                                             | Pexels 13120070                                      | Pexels        |
| `volunteers/jasmine-bennett.jpg`                                           | Pexels 6976400                                       | Pexels        |
| `volunteers/diego-weber.jpg`                                               | Pexels 19285927                                      | Pexels        |
| `volunteers/nico-carter.jpg`                                               | Pexels 8151688                                       | Pexels        |
| `volunteers/gloria-weber.jpg`                                              | Pexels 30004320                                      | Pexels        |

Pexels images use the [Pexels License](https://www.pexels.com/license/). Wikimedia images use
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The in-app photo credits page
reads the same list from `src/data/credits.ts`.

Bundled fonts: Geist Variable, Geist Mono Variable, and Source Serif 4 Variable, all under the
SIL Open Font License 1.1.

Main libraries: React, React Router, TanStack Query, date-fns, Lucide, Tauri, rusqlite,
chrono, serde, uuid, thiserror, Vitest, Testing Library, and jest-axe. The AutoRoster flow
algorithm was implemented from published descriptions rather than copied code.

## Volunteer app

CivicFlow2 is `Praket7/civicflow` at `01b4bf4`, extended with a shared cloud
organization. `pwa.html` is an installable, offline-first volunteer client of
that organization: its own entry, its own Supabase session, and a replica
limited to the signed-in volunteer. Run `pnpm dev` and open
`http://localhost:5173/pwa.html`; a production build emits `dist/pwa.html`,
the manifest, the service worker and the icons.

Authority is the database, not the client. A browser can only `select`; every
write is a command (`apply_command`) with one operation id, an idempotency
ledger, and the membership epoch it was created under. `pull_changes` returns
`sequence > cursor`, and the cursor advances in the same IndexedDB transaction
that writes the rows. Realtime only wakes the device; the change log remains
the truth.

The local replica holds the volunteer's own profile and participation, their
organization's published shifts, and their notifications. It never caches the
roster or another person's data; row-level security decides what can arrive.

Offline writes live in a Dexie outbox with attempts, backoff and jitter. A
crash during upload is recovered after two minutes and retried under the same
operation id. Registration, waitlist, attendance and hours commands are never
merged field by field: a refusal becomes a conflict with the local payload and
the server's authoritative values. A revoked membership stops the app behind
an access-changed screen instead of letting a stale device keep writing.

A check-in scan is a code, not a timestamp. The kiosk prints
`civicflow://checkin/<token>`; the app also accepts the six-digit code. An
offline scan is queued with the code and device time, and the server re-checks
the window, code expiry and registration when it arrives.

### Pilot status

Phase 1 is deployed and verified against the hosted project: two volunteers on
one organization, a one-seat race that produced exactly one registration and
one waitlist entry, a lost response retried without a duplicate write, a
revoked device refused with `stale_authority`, and a restored membership that
pulled again. The reproduction accounts are `maya.volunteer@civicflow.test`,
`alice.volunteer@civicflow.test` and `jordan.coordinator@civicflow.test`, all
with the test password `Volunteer!2026`.

The volunteer app covers discovery, registration, waitlist, schedule, hours,
credentials, notifications, profile, settings, check-in and offline queueing.
Coordinator screens are intentionally absent from the phone app; the desktop
opens the same hosted workspace when a coordinator needs device health.

Reminder generation, delivery claiming, the push adapter, the encrypted archive,
SQLCipher at rest, the health dashboard and the signed updater are built. Push is
the only outbound channel; email and SMS were removed rather than left half
configured. No release feed is published, and camera scanning and push have not
been exercised on a physical phone.

## Known limits

- The local SQLite workspace is local to one device. The shared hosted workspace is live and
  available in both shells: the desktop signs in once (keychain) and mounts the hosted client,
  which carries the same offline outbox and command authority as the phone. Its coordinator
  view stops at device and delivery health rather than roster editing, so planning, AutoRoster
  and reports still run on the local workspace and travel as exports.
- Organization switching is scoped by membership in the UI and core, but all organizations in
  one installation share the same SQLite file. A future workspace manager will split them into
  per-organization databases.
- Kiosk mode is a coordinator route in the main window, not a separate OS-level kiosk.
- QR scanning needs camera permission. The six-digit code is the fallback.
- Code signing and notarization require certificates that are not in the repository.
- The accessibility audits are automated. A recorded screen-reader pass on the packaged build
  is still pending.
