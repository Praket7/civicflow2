# Third-party notices

CivicFlow is released under the MIT License. See [LICENSE](LICENSE).

This file is generated from `package.json`, the pnpm lockfile, and
`src-tauri/Cargo.lock` by `node scripts/generate-third-party.mjs`. Do not edit
it by hand; change the dependency and regenerate. `pnpm check:third-party`
fails when it is out of date.

## Direct dependencies and why they are here

| Package or crate | Why it is in the build |
| --- | --- |
| `@fontsource-variable/geist` | Bundled interface typeface (Geist). |
| `@fontsource-variable/geist-mono` | Bundled monospace typeface for codes and figures. |
| `@fontsource-variable/source-serif-4` | Bundled editorial typeface for headings. |
| `@supabase/supabase-js` | Hosted workspace client: authentication, command sync, and realtime reads. |
| `@tanstack/react-query` | Server-state cache for workspace reads, with retries and invalidation. |
| `@tauri-apps/api` | IPC bridge between the React shell and the Rust core. |
| `@tauri-apps/plugin-deep-link` | CivicFlow links open the installed desktop app. |
| `@tauri-apps/plugin-dialog` | Native file pickers for backup, restore, and CSV import. |
| `@tauri-apps/plugin-process` | Relaunch after an update is installed. |
| `@tauri-apps/plugin-updater` | Signed update checks against the release feed. |
| `@zxing/browser` | Camera QR decoding for kiosk check-in. |
| `argon2` | Argon2id key derivation for backup passphrases and password hashes. |
| `base64` | Encoding for sealed archive payloads. |
| `chacha20poly1305` | XChaCha20-Poly1305 encryption for sealed backup archives. |
| `chrono` | Time-zone-aware timestamps in the Rust core. |
| `civicflow-core` | Local domain crate: persistence, policy, and read models. |
| `date-fns` | Time-zone-safe date arithmetic and formatting. |
| `dexie` | IndexedDB schema and queries for the offline command outbox. |
| `getrandom` | Operating-system randomness for keys and salts. |
| `keyring` | Stores the SQLCipher key in the operating system credential store. |
| `lucide-react` | Interface icons, bundled as tree-shaken SVG components. |
| `qrcode` | Generates the check-in QR code volunteers scan or print. |
| `react` | Interface runtime. |
| `react-dom` | DOM renderer for the React interface. |
| `react-router-dom` | Client-side routes for the 50 registered screens. |
| `rusqlite` | SQLite access, compiled with SQLCipher and vendored OpenSSL. |
| `serde` | Serialization across the IPC boundary and into the database. |
| `serde_json` | JSON encoding for IPC payloads and the authored demo seed. |
| `sha2` | SHA-256 digests for verification codes and archive checks. |
| `tauri` | Desktop shell with a capability-scoped IPC surface. |
| `tauri-build` | Build-time Tauri configuration and asset embedding. |
| `tauri-plugin-deep-link` | Desktop registration for civicflow:// links. |
| `tauri-plugin-dialog` | Native dialogs for backup and import. |
| `tauri-plugin-process` | Process control for the updater. |
| `tauri-plugin-updater` | Signed desktop updates from the release feed. |
| `thiserror` | Typed domain errors that reach the interface as stable codes. |
| `uuid` | Identifier generation for records and commands. |

## Bundled native libraries

The desktop database is SQLCipher, compiled through `rusqlite` with
`bundled-sqlcipher-vendored-openssl`. That build statically links:

- **SQLCipher** — Copyright (c) 2008–2012 Zetetic LLC. BSD-style license.
- **OpenSSL** — Copyright 1998–2025 The OpenSSL Project Authors. Apache License 2.0.
- **SQLite** — public domain.

Their source and license files are distributed with the crates in the Cargo
registry and are reproduced in a release's source archive. CivicFlow does not
modify either library's behavior; the encryption key is generated on first run
and stored in the operating system credential store.

## Fonts

Geist, Geist Mono, and Source Serif 4 are bundled under the SIL Open Font
License 1.1. The full license text is in
[public/licenses/OFL-1.1.txt](public/licenses/OFL-1.1.txt).

## Photography

Bundled photographs are not covered by the MIT License. Pexels photographs are
used under the Pexels License; the two Wikimedia Commons images are used under
CC BY-SA 4.0 and remain under that license. The per-file provenance, creator,
and source URL are in [public/media/LICENSE.md](public/media/LICENSE.md) and on
the in-app credits screen.

## Generated inventory

### JavaScript (61 packages)

| Package | Version | License | Direct |
| --- | --- | --- | --- |
| `@fontsource-variable/geist` | 5.3.0 | OFL-1.1 | yes |
| `@fontsource-variable/geist-mono` | 5.3.0 | OFL-1.1 | yes |
| `@fontsource-variable/source-serif-4` | 5.3.1 | OFL-1.1 | yes |
| `@supabase/auth-js` | 2.118.0 | MIT | no |
| `@supabase/functions-js` | 2.118.0 | MIT | no |
| `@supabase/phoenix` | 0.4.5 | MIT | no |
| `@supabase/postgrest-js` | 2.118.0 | MIT | no |
| `@supabase/realtime-js` | 2.118.0 | MIT | no |
| `@supabase/storage-js` | 2.118.0 | MIT | no |
| `@supabase/supabase-js` | 2.118.0 | MIT | yes |
| `@tanstack/query-core` | 5.104.5 | MIT | no |
| `@tanstack/react-query` | 5.104.5 | MIT | yes |
| `@tauri-apps/api` | 2.12.4 | Apache-2.0 OR MIT | yes |
| `@tauri-apps/plugin-deep-link` | 2.6.2 | MIT OR Apache-2.0 | yes |
| `@tauri-apps/plugin-dialog` | 2.8.3 | MIT OR Apache-2.0 | yes |
| `@tauri-apps/plugin-process` | 2.4.0 | MIT OR Apache-2.0 | yes |
| `@tauri-apps/plugin-updater` | 2.14.1 | MIT OR Apache-2.0 | yes |
| `@zxing/browser` | 0.2.1 | MIT | yes |
| `@zxing/library` | 0.23.0 | Apache-2.0 | no |
| `ansi-regex` | 5.0.1 | MIT | no |
| `ansi-styles` | 4.3.0 | MIT | no |
| `camelcase` | 5.3.1 | MIT | no |
| `cliui` | 6.0.0 | ISC | no |
| `color-convert` | 2.0.1 | MIT | no |
| `color-name` | 1.1.4 | MIT | no |
| `cookie` | 1.1.1 | MIT | no |
| `date-fns` | 4.4.0 | MIT | yes |
| `decamelize` | 1.2.0 | MIT | no |
| `dexie` | 4.4.7 | Apache-2.0 | yes |
| `dijkstrajs` | 1.0.3 | MIT | no |
| `emoji-regex` | 8.0.0 | MIT | no |
| `find-up` | 4.1.0 | MIT | no |
| `get-caller-file` | 2.0.5 | ISC | no |
| `iceberg-js` | 0.8.1 | MIT | no |
| `is-fullwidth-code-point` | 3.0.0 | MIT | no |
| `locate-path` | 5.0.0 | MIT | no |
| `lucide-react` | 1.61.0 | ISC | yes |
| `p-limit` | 2.3.0 | MIT | no |
| `p-locate` | 4.1.0 | MIT | no |
| `p-try` | 2.2.0 | MIT | no |
| `path-exists` | 4.0.0 | MIT | no |
| `pngjs` | 5.0.0 | MIT | no |
| `qrcode` | 1.5.4 | MIT | yes |
| `react` | 19.3.1 | MIT | yes |
| `react-dom` | 19.3.1 | MIT | yes |
| `react-router` | 7.18.4 | MIT | no |
| `react-router-dom` | 7.18.4 | MIT | yes |
| `require-directory` | 2.1.1 | MIT | no |
| `require-main-filename` | 2.0.0 | ISC | no |
| `scheduler` | 0.28.0 | MIT | no |
| `set-blocking` | 2.0.0 | ISC | no |
| `set-cookie-parser` | 2.7.2 | MIT | no |
| `string-width` | 4.2.3 | MIT | no |
| `strip-ansi` | 6.0.1 | MIT | no |
| `ts-custom-error` | 3.3.1 | MIT | no |
| `tslib` | 2.8.1 | 0BSD | no |
| `which-module` | 2.0.1 | ISC | no |
| `wrap-ansi` | 6.2.0 | MIT | no |
| `y18n` | 4.0.3 | ISC | no |
| `yargs` | 15.4.1 | MIT | no |
| `yargs-parser` | 18.1.3 | ISC | no |
### Rust (527 crates)

| Package | Version | License | Direct |
| --- | --- | --- | --- |
| `adler2` | 2.0.1 | 0BSD OR MIT OR Apache-2.0 | no |
| `aead` | 0.5.2 | MIT OR Apache-2.0 | no |
| `aho-corasick` | 1.1.5 | Unlicense OR MIT | no |
| `alloc-no-stdlib` | 3.0.0 | BSD-3-Clause | no |
| `alloc-stdlib` | 0.3.0 | BSD-3-Clause | no |
| `android_system_properties` | 0.1.6 | MIT OR Apache-2.0 | no |
| `anyhow` | 1.0.104 | MIT OR Apache-2.0 | no |
| `argon2` | 0.5.3 | MIT OR Apache-2.0 | no |
| `async-trait` | 0.1.92 | MIT OR Apache-2.0 | no |
| `atk` | 0.18.2 | MIT | no |
| `atk-sys` | 0.18.2 | MIT | no |
| `atomic-waker` | 1.1.2 | Apache-2.0 OR MIT | no |
| `autocfg` | 1.5.1 | Apache-2.0 OR MIT | no |
| `axum` | 0.8.9 | MIT | no |
| `axum-core` | 0.5.6 | MIT | no |
| `base64` | 0.21.7 | MIT OR Apache-2.0 | no |
| `base64` | 0.22.1 | MIT OR Apache-2.0 | no |
| `base64` | 0.23.1 | MIT OR Apache-2.0 | no |
| `base64ct` | 1.8.3 | Apache-2.0 OR MIT | no |
| `bit-set` | 0.8.0 | Apache-2.0 OR MIT | no |
| `bit-vec` | 0.8.0 | Apache-2.0 OR MIT | no |
| `bitflags` | 1.3.2 | MIT/Apache-2.0 | no |
| `bitflags` | 2.13.2 | MIT OR Apache-2.0 | no |
| `blake2` | 0.10.6 | MIT OR Apache-2.0 | no |
| `block-buffer` | 0.10.4 | MIT OR Apache-2.0 | no |
| `block2` | 0.6.2 | MIT | no |
| `brotli` | 9.0.0 | BSD-3-Clause AND MIT | no |
| `brotli-decompressor` | 6.0.1 | BSD-3-Clause/MIT | no |
| `bs58` | 0.5.1 | MIT/Apache-2.0 | no |
| `bumpalo` | 3.20.3 | MIT OR Apache-2.0 | no |
| `bytemuck` | 1.25.2 | Zlib OR Apache-2.0 OR MIT | no |
| `byteorder` | 1.5.0 | Unlicense OR MIT | no |
| `bytes` | 1.12.1 | MIT | no |
| `cairo-rs` | 0.18.5 | MIT | no |
| `cairo-sys-rs` | 0.18.2 | MIT | no |
| `camino` | 1.2.6 | MIT OR Apache-2.0 | no |
| `cargo-platform` | 0.1.9 | MIT OR Apache-2.0 | no |
| `cargo_metadata` | 0.19.2 | MIT | no |
| `cargo_toml` | 1.0.1 | Apache-2.0 OR MIT | no |
| `cc` | 1.9.0 | MIT OR Apache-2.0 | no |
| `cesu8` | 1.1.0 | Apache-2.0/MIT | no |
| `cfb` | 0.14.0 | MIT | no |
| `cfg-expr` | 0.15.8 | MIT OR Apache-2.0 | no |
| `cfg-expr` | 0.20.10 | MIT OR Apache-2.0 | no |
| `cfg-if` | 1.0.5 | MIT OR Apache-2.0 | no |
| `cfg_aliases` | 0.2.2 | MIT | no |
| `chacha20` | 0.9.1 | Apache-2.0 OR MIT | no |
| `chacha20poly1305` | 0.10.1 | Apache-2.0 OR MIT | no |
| `chrono` | 0.4.45 | MIT OR Apache-2.0 | no |
| `cipher` | 0.4.4 | MIT OR Apache-2.0 | no |
| `combine` | 4.6.9 | MIT | no |
| `const-random` | 0.1.18 | MIT OR Apache-2.0 | no |
| `const-random-macro` | 0.1.16 | MIT OR Apache-2.0 | no |
| `cookie` | 0.18.2 | MIT OR Apache-2.0 | no |
| `core-foundation` | 0.10.1 | MIT OR Apache-2.0 | no |
| `core-foundation` | 0.9.4 | MIT OR Apache-2.0 | no |
| `core-foundation-sys` | 0.8.7 | MIT OR Apache-2.0 | no |
| `core-graphics` | 0.25.0 | MIT OR Apache-2.0 | no |
| `core-graphics-types` | 0.2.0 | MIT OR Apache-2.0 | no |
| `cpufeatures` | 0.2.17 | MIT OR Apache-2.0 | no |
| `crc32fast` | 1.5.3 | MIT OR Apache-2.0 | no |
| `crossbeam-channel` | 0.5.17 | MIT OR Apache-2.0 | no |
| `crossbeam-utils` | 0.8.23 | MIT OR Apache-2.0 | no |
| `crunchy` | 0.2.4 | MIT | no |
| `crypto-common` | 0.1.7 | MIT OR Apache-2.0 | no |
| `cssparser` | 0.37.0 | MPL-2.0 | no |
| `cssparser-macros` | 0.7.1 | MPL-2.0 | no |
| `ctor` | 1.0.13 | Apache-2.0 OR MIT | no |
| `darling` | 0.24.1 | MIT | no |
| `darling_core` | 0.24.1 | MIT | no |
| `darling_macro` | 0.24.1 | MIT | no |
| `dbus` | 0.9.12 | Apache-2.0/MIT | no |
| `defmt` | 1.2.0 | MIT OR Apache-2.0 | no |
| `defmt-macros` | 1.2.0 | MIT OR Apache-2.0 | no |
| `defmt-parser` | 1.1.0 | MIT OR Apache-2.0 | no |
| `deranged` | 0.5.9 | MIT OR Apache-2.0 | no |
| `derive_more` | 2.1.1 | MIT | no |
| `derive_more-impl` | 2.1.1 | MIT | no |
| `digest` | 0.10.7 | MIT OR Apache-2.0 | no |
| `dirs` | 7.0.0 | MIT OR Apache-2.0 | no |
| `dirs-sys` | 0.5.0 | MIT OR Apache-2.0 | no |
| `dispatch2` | 0.3.1 | Zlib OR Apache-2.0 OR MIT | no |
| `displaydoc` | 0.2.7 | MIT OR Apache-2.0 | no |
| `dlopen2` | 0.8.2 | MIT | no |
| `dlopen2_derive` | 0.4.3 | MIT | no |
| `dlv-list` | 0.5.2 | MIT OR Apache-2.0 | no |
| `dom_query` | 0.28.0 | MIT | no |
| `dpi` | 0.1.2 | Apache-2.0 AND MIT | no |
| `dtoa` | 1.0.11 | MIT OR Apache-2.0 | no |
| `dtoa-short` | 0.3.5 | MPL-2.0 | no |
| `dunce` | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 | no |
| `dyn-clone` | 1.0.20 | MIT OR Apache-2.0 | no |
| `embed-resource` | 3.0.12 | MIT | no |
| `embed_plist` | 1.2.2 | MIT OR Apache-2.0 | no |
| `equivalent` | 1.0.3 | Apache-2.0 OR MIT | no |
| `erased-serde` | 0.4.10 | MIT OR Apache-2.0 | no |
| `errno` | 0.3.14 | MIT OR Apache-2.0 | no |
| `fallible-iterator` | 0.3.0 | MIT/Apache-2.0 | no |
| `fallible-streaming-iterator` | 0.1.9 | MIT/Apache-2.0 | no |
| `fastrand` | 2.5.0 | Apache-2.0 OR MIT | no |
| `fdeflate` | 0.3.7 | MIT OR Apache-2.0 | no |
| `field-offset` | 0.3.6 | MIT OR Apache-2.0 | no |
| `filetime` | 0.2.29 | MIT/Apache-2.0 | no |
| `find-msvc-tools` | 0.1.15 | MIT OR Apache-2.0 | no |
| `flate2` | 1.1.10 | MIT OR Apache-2.0 | no |
| `fnv` | 1.0.7 | Apache-2.0 / MIT | no |
| `foldhash` | 0.1.5 | Zlib | no |
| `foldhash` | 0.2.0 | Zlib | no |
| `foreign-types` | 0.5.0 | MIT/Apache-2.0 | no |
| `foreign-types-macros` | 0.2.4 | MIT/Apache-2.0 | no |
| `foreign-types-shared` | 0.3.1 | MIT/Apache-2.0 | no |
| `form_urlencoded` | 1.2.2 | MIT OR Apache-2.0 | no |
| `futures-channel` | 0.3.34 | MIT OR Apache-2.0 | no |
| `futures-core` | 0.3.34 | MIT OR Apache-2.0 | no |
| `futures-executor` | 0.3.34 | MIT OR Apache-2.0 | no |
| `futures-io` | 0.3.34 | MIT OR Apache-2.0 | no |
| `futures-macro` | 0.3.34 | MIT OR Apache-2.0 | no |
| `futures-sink` | 0.3.34 | MIT OR Apache-2.0 | no |
| `futures-task` | 0.3.34 | MIT OR Apache-2.0 | no |
| `futures-util` | 0.3.34 | MIT OR Apache-2.0 | no |
| `gdk` | 0.18.2 | MIT | no |
| `gdk-pixbuf` | 0.18.5 | MIT | no |
| `gdk-pixbuf-sys` | 0.18.0 | MIT | no |
| `gdk-sys` | 0.18.2 | MIT | no |
| `gdkwayland-sys` | 0.18.2 | MIT | no |
| `gdkx11` | 0.18.2 | MIT | no |
| `gdkx11-sys` | 0.18.2 | MIT | no |
| `generic-array` | 0.14.7 | MIT | no |
| `getrandom` | 0.2.17 | MIT OR Apache-2.0 | yes |
| `getrandom` | 0.3.4 | MIT OR Apache-2.0 | yes |
| `getrandom` | 0.4.3 | MIT OR Apache-2.0 | yes |
| `gio` | 0.18.4 | MIT | no |
| `gio-sys` | 0.18.1 | MIT | no |
| `gio-sys` | 0.21.5 | MIT | no |
| `glib` | 0.18.5 | MIT | no |
| `glib` | 0.21.5 | MIT | no |
| `glib-macros` | 0.18.5 | MIT | no |
| `glib-macros` | 0.21.5 | MIT | no |
| `glib-sys` | 0.18.1 | MIT | no |
| `glib-sys` | 0.21.5 | MIT | no |
| `glob` | 0.3.4 | MIT OR Apache-2.0 | no |
| `gobject-sys` | 0.18.0 | MIT | no |
| `gobject-sys` | 0.21.5 | MIT | no |
| `gtk` | 0.18.2 | MIT | no |
| `gtk-sys` | 0.18.2 | MIT | no |
| `gtk3-macros` | 0.18.2 | MIT | no |
| `hashbrown` | 0.12.3 | MIT OR Apache-2.0 | no |
| `hashbrown` | 0.14.5 | MIT OR Apache-2.0 | no |
| `hashbrown` | 0.15.5 | MIT OR Apache-2.0 | no |
| `hashbrown` | 0.17.1 | MIT OR Apache-2.0 | no |
| `hashlink` | 0.10.0 | MIT OR Apache-2.0 | no |
| `heck` | 0.4.1 | MIT OR Apache-2.0 | no |
| `heck` | 0.5.0 | MIT OR Apache-2.0 | no |
| `hex` | 0.4.3 | MIT OR Apache-2.0 | no |
| `html5ever` | 0.39.0 | MIT OR Apache-2.0 | no |
| `http` | 1.5.0 | MIT OR Apache-2.0 | no |
| `http-body` | 1.1.0 | MIT | no |
| `http-body-util` | 0.1.5 | MIT | no |
| `httparse` | 1.10.1 | MIT OR Apache-2.0 | no |
| `httpdate` | 1.0.3 | MIT OR Apache-2.0 | no |
| `hyper` | 1.12.0 | MIT | no |
| `hyper-rustls` | 0.27.10 | Apache-2.0 OR ISC OR MIT | no |
| `hyper-util` | 0.1.21 | MIT | no |
| `iana-time-zone` | 0.1.65 | MIT OR Apache-2.0 | no |
| `iana-time-zone-haiku` | 0.1.2 | MIT OR Apache-2.0 | no |
| `ico` | 0.6.0 | MIT | no |
| `icu_collections` | 2.4.0 | Unicode-3.0 | no |
| `icu_locale_core` | 2.4.0 | Unicode-3.0 | no |
| `icu_normalizer` | 2.4.0 | Unicode-3.0 | no |
| `icu_normalizer_data` | 2.4.0 | Unicode-3.0 | no |
| `icu_properties` | 2.4.0 | Unicode-3.0 | no |
| `icu_properties_data` | 2.4.0 | Unicode-3.0 | no |
| `icu_provider` | 2.4.0 | Unicode-3.0 | no |
| `ident_case` | 1.0.1 | MIT/Apache-2.0 | no |
| `idna` | 1.1.0 | MIT OR Apache-2.0 | no |
| `idna_adapter` | 1.2.2 | Apache-2.0 OR MIT | no |
| `indexmap` | 1.9.3 | Apache-2.0 OR MIT | no |
| `indexmap` | 2.14.2 | Apache-2.0 OR MIT | no |
| `infer` | 0.22.0 | MIT | no |
| `inout` | 0.1.4 | MIT OR Apache-2.0 | no |
| `ipnet` | 2.12.2 | MIT OR Apache-2.0 | no |
| `itoa` | 1.0.18 | MIT OR Apache-2.0 | no |
| `javascriptcore-rs` | 1.1.2 | MIT | no |
| `javascriptcore-rs-sys` | 1.1.1 | MIT | no |
| `jiff` | 0.2.38 | Unlicense OR MIT | no |
| `jiff-core` | 0.1.1 | Unlicense OR MIT | no |
| `jiff-static` | 0.2.38 | Unlicense OR MIT | no |
| `jiff-tzdb` | 0.1.9 | Unlicense OR MIT | no |
| `jiff-tzdb-platform` | 0.1.3 | Unlicense OR MIT | no |
| `jni` | 0.21.1 | MIT/Apache-2.0 | no |
| `jni` | 0.22.4 | MIT OR Apache-2.0 | no |
| `jni-macros` | 0.22.4 | MIT OR Apache-2.0 | no |
| `jni-sys` | 0.3.1 | MIT OR Apache-2.0 | no |
| `jni-sys` | 0.4.1 | MIT OR Apache-2.0 | no |
| `jni-sys-macros` | 0.4.1 | MIT OR Apache-2.0 | no |
| `js-sys` | 0.3.106 | MIT OR Apache-2.0 | no |
| `json-patch` | 4.2.0 | MIT/Apache-2.0 | no |
| `jsonptr` | 0.7.1 | MIT OR Apache-2.0 | no |
| `keyboard-types` | 0.8.3 | MIT OR Apache-2.0 | no |
| `keyring` | 3.6.3 | MIT OR Apache-2.0 | yes |
| `libappindicator` | 0.9.0 | Apache-2.0 OR MIT | no |
| `libappindicator-sys` | 0.9.0 | Apache-2.0 OR MIT | no |
| `libc` | 0.2.191 | MIT OR Apache-2.0 | no |
| `libdbus-sys` | 0.2.7 | Apache-2.0/MIT | no |
| `libloading` | 0.7.4 | ISC | no |
| `libredox` | 0.1.25 | MIT | no |
| `libsqlite3-sys` | 0.35.0 | MIT | no |
| `linux-raw-sys` | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | no |
| `litemap` | 0.8.3 | Unicode-3.0 | no |
| `lock_api` | 0.4.14 | MIT OR Apache-2.0 | no |
| `log` | 0.4.34 | MIT OR Apache-2.0 | no |
| `markup5ever` | 0.39.0 | MIT OR Apache-2.0 | no |
| `matchit` | 0.8.4 | MIT AND BSD-3-Clause | no |
| `memchr` | 2.8.3 | Unlicense OR MIT | no |
| `memoffset` | 0.9.1 | MIT | no |
| `mime` | 0.3.17 | MIT OR Apache-2.0 | no |
| `minisign-verify` | 0.3.0 | MIT | no |
| `miniz_oxide` | 0.8.9 | MIT OR Zlib OR Apache-2.0 | no |
| `miniz_oxide` | 0.9.1 | MIT OR Zlib OR Apache-2.0 | no |
| `mio` | 1.2.4 | MIT | no |
| `muda` | 0.20.0 | Apache-2.0 OR MIT | no |
| `ndk` | 0.9.0 | MIT OR Apache-2.0 | no |
| `ndk-context` | 0.1.1 | MIT OR Apache-2.0 | no |
| `ndk-sys` | 0.6.0+11769913 | MIT OR Apache-2.0 | no |
| `new_debug_unreachable` | 1.0.6 | MIT | no |
| `nix` | 0.31.3 | MIT | no |
| `num-conv` | 0.2.2 | MIT OR Apache-2.0 | no |
| `num-traits` | 0.2.19 | MIT OR Apache-2.0 | no |
| `num_enum` | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 | no |
| `num_enum_derive` | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 | no |
| `objc2` | 0.6.5 | MIT | no |
| `objc2-app-kit` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-cloud-kit` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-core-data` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-core-foundation` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-core-graphics` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-core-image` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-core-location` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-core-text` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-core-video` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-encode` | 4.1.0 | MIT | no |
| `objc2-exception-helper` | 0.1.1 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-foundation` | 0.3.2 | MIT | no |
| `objc2-io-surface` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-javascript-core` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-osa-kit` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-quartz-core` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-security` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-ui-kit` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-user-notifications` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `objc2-web-kit` | 0.3.2 | Zlib OR Apache-2.0 OR MIT | no |
| `once_cell` | 1.21.4 | MIT OR Apache-2.0 | no |
| `opaque-debug` | 0.3.1 | MIT OR Apache-2.0 | no |
| `openssl-probe` | 0.2.2 | MIT OR Apache-2.0 | no |
| `openssl-src` | 300.6.1+3.6.3 | MIT/Apache-2.0 | no |
| `openssl-sys` | 0.9.117 | MIT | no |
| `option-ext` | 0.2.0 | MPL-2.0 | no |
| `ordered-multimap` | 0.7.3 | MIT | no |
| `osakit` | 0.3.1 | MIT OR Apache-2.0 | no |
| `pango` | 0.18.3 | MIT | no |
| `pango-sys` | 0.18.0 | MIT | no |
| `parking_lot` | 0.12.5 | MIT OR Apache-2.0 | no |
| `parking_lot_core` | 0.9.12 | MIT OR Apache-2.0 | no |
| `password-hash` | 0.5.0 | MIT OR Apache-2.0 | no |
| `percent-encoding` | 2.3.2 | MIT OR Apache-2.0 | no |
| `phf` | 0.13.1 | MIT | no |
| `phf_codegen` | 0.13.1 | MIT | no |
| `phf_generator` | 0.13.1 | MIT | no |
| `phf_macros` | 0.13.1 | MIT | no |
| `phf_shared` | 0.13.1 | MIT | no |
| `pin-project-lite` | 0.2.17 | Apache-2.0 OR MIT | no |
| `pkg-config` | 0.3.34 | MIT OR Apache-2.0 | no |
| `plist` | 1.10.3 | MIT | no |
| `png` | 0.18.1 | MIT OR Apache-2.0 | no |
| `poly1305` | 0.8.0 | Apache-2.0 OR MIT | no |
| `portable-atomic` | 1.15.0 | Apache-2.0 OR MIT | no |
| `portable-atomic-util` | 0.2.8 | Apache-2.0 OR MIT | no |
| `potential_utf` | 0.1.6 | Unicode-3.0 | no |
| `powerfmt` | 0.2.1 | MIT OR Apache-2.0 | no |
| `precomputed-hash` | 0.1.1 | MIT | no |
| `proc-macro-crate` | 1.3.1 | MIT OR Apache-2.0 | no |
| `proc-macro-crate` | 2.0.2 | MIT OR Apache-2.0 | no |
| `proc-macro-crate` | 3.5.0 | MIT OR Apache-2.0 | no |
| `proc-macro-error` | 1.0.4 | MIT OR Apache-2.0 | no |
| `proc-macro-error-attr` | 1.0.4 | MIT OR Apache-2.0 | no |
| `proc-macro2` | 1.0.107 | MIT OR Apache-2.0 | no |
| `quick-xml` | 0.42.0 | MIT | no |
| `quote` | 1.0.47 | MIT OR Apache-2.0 | no |
| `r-efi` | 5.3.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later | no |
| `r-efi` | 6.0.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later | no |
| `rand_core` | 0.6.4 | MIT OR Apache-2.0 | no |
| `raw-window-handle` | 0.6.2 | MIT OR Apache-2.0 OR Zlib | no |
| `redox_syscall` | 0.5.18 | MIT | no |
| `redox_users` | 0.5.3 | MIT | no |
| `ref-cast` | 1.0.27 | MIT OR Apache-2.0 | no |
| `ref-cast-impl` | 1.0.27 | MIT OR Apache-2.0 | no |
| `regex` | 1.13.1 | MIT OR Apache-2.0 | no |
| `regex-automata` | 0.4.18 | MIT OR Apache-2.0 | no |
| `regex-syntax` | 0.8.11 | MIT OR Apache-2.0 | no |
| `reqwest` | 0.13.5 | MIT OR Apache-2.0 | no |
| `rfd` | 0.16.1 | MIT | no |
| `ring` | 0.17.14 | Apache-2.0 AND ISC | no |
| `rusqlite` | 0.37.0 | MIT | no |
| `rust-ini` | 0.21.3 | MIT | no |
| `rustc-hash` | 2.1.3 | Apache-2.0 OR MIT | no |
| `rustc_version` | 0.4.1 | MIT OR Apache-2.0 | no |
| `rustix` | 1.1.5 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | no |
| `rustls` | 0.23.46 | Apache-2.0 OR ISC OR MIT | no |
| `rustls-native-certs` | 0.8.5 | Apache-2.0 OR ISC OR MIT | no |
| `rustls-pki-types` | 1.15.1 | MIT OR Apache-2.0 | no |
| `rustls-platform-verifier` | 0.7.1 | MIT OR Apache-2.0 | no |
| `rustls-platform-verifier-android` | 0.2.0 | MIT OR Apache-2.0 | no |
| `rustls-webpki` | 0.103.16 | ISC | no |
| `rustversion` | 1.0.23 | MIT OR Apache-2.0 | no |
| `ryu` | 1.0.23 | Apache-2.0 OR BSL-1.0 | no |
| `same-file` | 1.0.6 | Unlicense/MIT | no |
| `schannel` | 0.1.30 | MIT | no |
| `schemars` | 0.8.22 | MIT | no |
| `schemars` | 0.9.0 | MIT | no |
| `schemars` | 1.2.3 | MIT | no |
| `schemars_derive` | 0.8.22 | MIT | no |
| `scopeguard` | 1.2.0 | MIT OR Apache-2.0 | no |
| `security-framework` | 3.7.0 | MIT OR Apache-2.0 | no |
| `security-framework-sys` | 2.17.0 | MIT OR Apache-2.0 | no |
| `selectors` | 0.38.0 | MPL-2.0 | no |
| `semver` | 1.0.28 | MIT OR Apache-2.0 | no |
| `serde` | 1.0.229 | MIT OR Apache-2.0 | yes |
| `serde-untagged` | 0.1.9 | MIT OR Apache-2.0 | no |
| `serde_core` | 1.0.229 | MIT OR Apache-2.0 | no |
| `serde_derive` | 1.0.229 | MIT OR Apache-2.0 | no |
| `serde_derive_internals` | 0.29.1 | MIT OR Apache-2.0 | no |
| `serde_json` | 1.0.154 | MIT OR Apache-2.0 | yes |
| `serde_path_to_error` | 0.1.20 | MIT OR Apache-2.0 | no |
| `serde_repr` | 0.1.21 | MIT OR Apache-2.0 | no |
| `serde_spanned` | 0.6.9 | MIT OR Apache-2.0 | no |
| `serde_spanned` | 1.1.2 | MIT OR Apache-2.0 | no |
| `serde_urlencoded` | 0.7.1 | MIT/Apache-2.0 | no |
| `serde_with` | 3.24.0 | MIT OR Apache-2.0 | no |
| `serde_with_macros` | 3.24.0 | MIT OR Apache-2.0 | no |
| `serialize-to-javascript` | 0.1.2 | MIT OR Apache-2.0 | no |
| `serialize-to-javascript-impl` | 0.1.2 | MIT OR Apache-2.0 | no |
| `servo_arc` | 0.4.3 | MIT OR Apache-2.0 | no |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 | no |
| `shlex` | 2.0.1 | MIT OR Apache-2.0 | no |
| `simd-adler32` | 0.3.10 | MIT | no |
| `simd_cesu8` | 1.2.0 | Apache-2.0 OR MIT | no |
| `simdutf8` | 0.1.5 | MIT OR Apache-2.0 | no |
| `siphasher` | 1.0.4 | MIT OR Apache-2.0 | no |
| `slab` | 0.4.12 | MIT | no |
| `smallvec` | 1.16.3 | MIT OR Apache-2.0 | no |
| `socket2` | 0.6.5 | MIT OR Apache-2.0 | no |
| `softbuffer` | 0.4.8 | MIT OR Apache-2.0 | no |
| `soup3` | 0.5.0 | MIT | no |
| `soup3-sys` | 0.5.0 | MIT | no |
| `stable_deref_trait` | 1.2.1 | MIT OR Apache-2.0 | no |
| `static_vcruntime` | 3.0.0 | MIT OR Apache-2.0 OR Zlib | no |
| `string_cache` | 0.9.0 | MIT OR Apache-2.0 | no |
| `string_cache_codegen` | 0.6.1 | MIT OR Apache-2.0 | no |
| `strsim` | 0.11.1 | MIT | no |
| `subtle` | 2.6.1 | BSD-3-Clause | no |
| `swift-rs` | 1.0.9 | MIT OR Apache-2.0 | no |
| `syn` | 1.0.109 | MIT OR Apache-2.0 | no |
| `syn` | 2.0.119 | MIT OR Apache-2.0 | no |
| `syn` | 3.0.9 | MIT OR Apache-2.0 | no |
| `sync_wrapper` | 1.0.2 | Apache-2.0 | no |
| `synstructure` | 0.14.0 | MIT | no |
| `system-configuration` | 0.7.0 | MIT OR Apache-2.0 | no |
| `system-configuration-sys` | 0.6.0 | MIT OR Apache-2.0 | no |
| `system-deps` | 6.2.2 | MIT OR Apache-2.0 | no |
| `system-deps` | 7.0.8 | MIT OR Apache-2.0 | no |
| `tao` | 0.37.1 | Apache-2.0 | no |
| `tao-macros` | 0.1.4 | MIT OR Apache-2.0 | no |
| `tar` | 0.4.46 | MIT OR Apache-2.0 | no |
| `target-lexicon` | 0.12.16 | Apache-2.0 WITH LLVM-exception | no |
| `target-lexicon` | 0.13.5 | Apache-2.0 WITH LLVM-exception | no |
| `tauri` | 2.12.5 | Apache-2.0 OR MIT | yes |
| `tauri-build` | 2.7.4 | Apache-2.0 OR MIT | yes |
| `tauri-codegen` | 2.7.4 | Apache-2.0 OR MIT | no |
| `tauri-macros` | 2.7.4 | Apache-2.0 OR MIT | no |
| `tauri-plugin` | 2.7.2 | Apache-2.0 OR MIT | no |
| `tauri-plugin-deep-link` | 2.6.0 | Apache-2.0 OR MIT | yes |
| `tauri-plugin-dialog` | 2.8.3 | Apache-2.0 OR MIT | yes |
| `tauri-plugin-fs` | 2.7.1 | Apache-2.0 OR MIT | no |
| `tauri-plugin-process` | 2.4.0 | Apache-2.0 OR MIT | yes |
| `tauri-plugin-updater` | 2.14.1 | Apache-2.0 OR MIT | yes |
| `tauri-plugin-wdio-webdriver` | 1.5.1 | MIT | yes |
| `tauri-runtime` | 2.12.2 | Apache-2.0 OR MIT | no |
| `tauri-runtime-wry` | 2.12.3 | Apache-2.0 OR MIT | no |
| `tauri-utils` | 2.10.2 | Apache-2.0 OR MIT | no |
| `tauri-winres` | 0.3.7 | MIT | no |
| `tempfile` | 3.27.0 | MIT OR Apache-2.0 | no |
| `tendril` | 0.5.1 | MIT OR Apache-2.0 | no |
| `thiserror` | 1.0.69 | MIT OR Apache-2.0 | no |
| `thiserror` | 2.0.21 | MIT OR Apache-2.0 | no |
| `thiserror-impl` | 1.0.69 | MIT OR Apache-2.0 | no |
| `thiserror-impl` | 2.0.21 | MIT OR Apache-2.0 | no |
| `time` | 0.3.55 | MIT OR Apache-2.0 | no |
| `time-core` | 0.1.9 | MIT OR Apache-2.0 | no |
| `time-macros` | 0.2.32 | MIT OR Apache-2.0 | no |
| `tiny-keccak` | 2.0.2 | CC0-1.0 | no |
| `tinystr` | 0.8.5 | Unicode-3.0 | no |
| `tinyvec` | 1.13.3 | Zlib OR Apache-2.0 OR MIT | no |
| `tokio` | 1.54.1 | MIT | no |
| `tokio-macros` | 2.7.2 | MIT | no |
| `tokio-rustls` | 0.26.6 | MIT OR Apache-2.0 | no |
| `tokio-util` | 0.7.20 | MIT | no |
| `toml` | 0.8.2 | MIT OR Apache-2.0 | no |
| `toml` | 1.1.8+spec-1.1.0 | MIT OR Apache-2.0 | no |
| `toml_datetime` | 0.6.3 | MIT OR Apache-2.0 | no |
| `toml_datetime` | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 | no |
| `toml_edit` | 0.19.15 | MIT OR Apache-2.0 | no |
| `toml_edit` | 0.20.2 | MIT OR Apache-2.0 | no |
| `toml_edit` | 0.25.17+spec-1.1.0 | MIT OR Apache-2.0 | no |
| `toml_parser` | 1.1.5+spec-1.1.0 | MIT OR Apache-2.0 | no |
| `toml_writer` | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0 | no |
| `tower` | 0.5.3 | MIT | no |
| `tower-http` | 0.6.11 | MIT | no |
| `tower-layer` | 0.3.3 | MIT | no |
| `tower-service` | 0.3.3 | MIT | no |
| `tracing` | 0.1.44 | MIT | no |
| `tracing-attributes` | 0.1.31 | MIT | no |
| `tracing-core` | 0.1.36 | MIT | no |
| `tray-icon` | 0.25.1 | MIT OR Apache-2.0 | no |
| `try-lock` | 0.2.5 | MIT | no |
| `typed-path` | 0.13.0 | MIT OR Apache-2.0 | no |
| `typeid` | 1.0.3 | MIT OR Apache-2.0 | no |
| `typenum` | 1.20.1 | MIT OR Apache-2.0 | no |
| `unicode-ident` | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | no |
| `unicode-segmentation` | 1.13.3 | MIT OR Apache-2.0 | no |
| `universal-hash` | 0.5.1 | MIT OR Apache-2.0 | no |
| `untrusted` | 0.9.0 | ISC | no |
| `url` | 2.5.8 | MIT OR Apache-2.0 | no |
| `urlpattern` | 0.6.0 | MIT | no |
| `utf8_iter` | 1.0.4 | Apache-2.0 OR MIT | no |
| `uuid` | 1.28.0 | Apache-2.0 OR MIT | no |
| `vcpkg` | 0.2.15 | MIT/Apache-2.0 | no |
| `version-compare` | 0.2.1 | MIT | no |
| `version_check` | 0.9.5 | MIT/Apache-2.0 | no |
| `vswhom` | 0.1.0 | MIT | no |
| `vswhom-sys` | 0.1.3 | MIT | no |
| `walkdir` | 2.5.0 | Unlicense/MIT | no |
| `want` | 0.3.2 | MIT | no |
| `wasi` | 0.11.1+wasi-snapshot-preview1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | no |
| `wasip2` | 1.0.4+wasi-0.2.12 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | no |
| `wasm-bindgen` | 0.2.129 | MIT OR Apache-2.0 | no |
| `wasm-bindgen-futures` | 0.4.79 | MIT OR Apache-2.0 | no |
| `wasm-bindgen-macro` | 0.2.129 | MIT OR Apache-2.0 | no |
| `wasm-bindgen-macro-support` | 0.2.129 | MIT OR Apache-2.0 | no |
| `wasm-bindgen-shared` | 0.2.129 | MIT OR Apache-2.0 | no |
| `wasm-streams` | 0.5.0 | MIT OR Apache-2.0 | no |
| `web-sys` | 0.3.106 | MIT OR Apache-2.0 | no |
| `web-time` | 1.1.0 | MIT OR Apache-2.0 | no |
| `web_atoms` | 0.2.6 | MIT OR Apache-2.0 | no |
| `webkit2gtk` | 2.0.2 | MIT | no |
| `webkit2gtk-sys` | 2.0.2 | MIT | no |
| `webpki-root-certs` | 1.0.11 | CDLA-Permissive-2.0 | no |
| `webview2-com` | 0.39.1 | MIT | no |
| `webview2-com-macros` | 0.8.1 | MIT | no |
| `webview2-com-sys` | 0.39.1 | MIT | no |
| `winapi` | 0.3.9 | MIT/Apache-2.0 | no |
| `winapi-i686-pc-windows-gnu` | 0.4.0 | MIT/Apache-2.0 | no |
| `winapi-util` | 0.1.11 | Unlicense OR MIT | no |
| `winapi-x86_64-pc-windows-gnu` | 0.4.0 | MIT/Apache-2.0 | no |
| `window-vibrancy` | 0.8.1 | Apache-2.0 OR MIT | no |
| `windows` | 0.62.2 | MIT OR Apache-2.0 | no |
| `windows-collections` | 0.3.2 | MIT OR Apache-2.0 | no |
| `windows-core` | 0.62.2 | MIT OR Apache-2.0 | no |
| `windows-future` | 0.3.2 | MIT OR Apache-2.0 | no |
| `windows-implement` | 0.60.2 | MIT OR Apache-2.0 | no |
| `windows-interface` | 0.59.3 | MIT OR Apache-2.0 | no |
| `windows-link` | 0.2.1 | MIT OR Apache-2.0 | no |
| `windows-numerics` | 0.3.1 | MIT OR Apache-2.0 | no |
| `windows-registry` | 0.6.1 | MIT OR Apache-2.0 | no |
| `windows-result` | 0.4.1 | MIT OR Apache-2.0 | no |
| `windows-strings` | 0.5.1 | MIT OR Apache-2.0 | no |
| `windows-sys` | 0.45.0 | MIT OR Apache-2.0 | no |
| `windows-sys` | 0.52.0 | MIT OR Apache-2.0 | no |
| `windows-sys` | 0.60.2 | MIT OR Apache-2.0 | no |
| `windows-sys` | 0.61.2 | MIT OR Apache-2.0 | no |
| `windows-targets` | 0.42.2 | MIT OR Apache-2.0 | no |
| `windows-targets` | 0.52.6 | MIT OR Apache-2.0 | no |
| `windows-targets` | 0.53.5 | MIT OR Apache-2.0 | no |
| `windows-threading` | 0.2.1 | MIT OR Apache-2.0 | no |
| `windows-version` | 0.1.7 | MIT OR Apache-2.0 | no |
| `windows_aarch64_gnullvm` | 0.42.2 | MIT OR Apache-2.0 | no |
| `windows_aarch64_gnullvm` | 0.52.6 | MIT OR Apache-2.0 | no |
| `windows_aarch64_gnullvm` | 0.53.1 | MIT OR Apache-2.0 | no |
| `windows_aarch64_msvc` | 0.42.2 | MIT OR Apache-2.0 | no |
| `windows_aarch64_msvc` | 0.52.6 | MIT OR Apache-2.0 | no |
| `windows_aarch64_msvc` | 0.53.1 | MIT OR Apache-2.0 | no |
| `windows_i686_gnu` | 0.42.2 | MIT OR Apache-2.0 | no |
| `windows_i686_gnu` | 0.52.6 | MIT OR Apache-2.0 | no |
| `windows_i686_gnu` | 0.53.1 | MIT OR Apache-2.0 | no |
| `windows_i686_gnullvm` | 0.52.6 | MIT OR Apache-2.0 | no |
| `windows_i686_gnullvm` | 0.53.1 | MIT OR Apache-2.0 | no |
| `windows_i686_msvc` | 0.42.2 | MIT OR Apache-2.0 | no |
| `windows_i686_msvc` | 0.52.6 | MIT OR Apache-2.0 | no |
| `windows_i686_msvc` | 0.53.1 | MIT OR Apache-2.0 | no |
| `windows_x86_64_gnu` | 0.42.2 | MIT OR Apache-2.0 | no |
| `windows_x86_64_gnu` | 0.52.6 | MIT OR Apache-2.0 | no |
| `windows_x86_64_gnu` | 0.53.1 | MIT OR Apache-2.0 | no |
| `windows_x86_64_gnullvm` | 0.42.2 | MIT OR Apache-2.0 | no |
| `windows_x86_64_gnullvm` | 0.52.6 | MIT OR Apache-2.0 | no |
| `windows_x86_64_gnullvm` | 0.53.1 | MIT OR Apache-2.0 | no |
| `windows_x86_64_msvc` | 0.42.2 | MIT OR Apache-2.0 | no |
| `windows_x86_64_msvc` | 0.52.6 | MIT OR Apache-2.0 | no |
| `windows_x86_64_msvc` | 0.53.1 | MIT OR Apache-2.0 | no |
| `winnow` | 0.5.40 | MIT | no |
| `winnow` | 1.0.4 | MIT | no |
| `winreg` | 0.56.0 | MIT | no |
| `wit-bindgen` | 0.57.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | no |
| `writeable` | 0.6.4 | Unicode-3.0 | no |
| `wry` | 0.57.0 | Apache-2.0 OR MIT | no |
| `x11` | 2.21.0 | MIT | no |
| `x11-dl` | 2.21.0 | MIT | no |
| `xattr` | 1.6.1 | MIT OR Apache-2.0 | no |
| `yoke` | 0.8.4 | Unicode-3.0 | no |
| `yoke-derive` | 0.8.4 | Unicode-3.0 | no |
| `zerofrom` | 0.1.8 | Unicode-3.0 | no |
| `zerofrom-derive` | 0.1.8 | Unicode-3.0 | no |
| `zeroize` | 1.9.1 | Apache-2.0 OR MIT | no |
| `zerotrie` | 0.2.5 | Unicode-3.0 | no |
| `zerovec` | 0.11.9 | Unicode-3.0 | no |
| `zerovec-derive` | 0.11.7 | Unicode-3.0 | no |
| `zip` | 9.1.3 | MIT | no |
| `zlib-rs` | 0.6.8 | Zlib | no |
| `zmij` | 1.0.23 | MIT | no |
