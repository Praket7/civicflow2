//! Encrypted, portable backups.
//!
//! A snapshot in the workspace backup directory is a copy of the live database.
//! That is the right shape for a restore on this machine, but it is the wrong
//! shape for a copy that leaves the machine: the file is only as private as the
//! disk it lands on. An archive is therefore a snapshot sealed with a key that
//! never leaves the coordinator's head.
//!
//! Layout, so an archive can be recognised and a wrong passphrase reported
//! before any ciphertext is trusted:
//!
//! ```text
//! "CIVICFLOW-ARCHIVE-1\n"      magic, and the version it belongs to
//! u32                          header length, little endian
//! header                       JSON, used as associated data
//! ciphertext                   XChaCha20-Poly1305 over the snapshot
//! ```
//!
//! The header carries the salt and the work factors, so an archive written by a
//! later build stays readable once those change. It is authenticated as
//! associated data, which means a tampered cost parameter fails the same way a
//! tampered byte of the snapshot does.

use std::fs;
use std::path::{Path, PathBuf};

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::backups;
use crate::error::{CoreError, Result};
use crate::models::BackupRestoreResult;

const MAGIC: &[u8] = b"CIVICFLOW-ARCHIVE-1\n";
const VERSION: u8 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const KEY_LEN: usize = 32;
/// 19 MiB and three passes: expensive for a guess, about a second on a laptop.
const MEMORY_KIB: u32 = 19_456;
const ITERATIONS: u32 = 3;
const PARALLELISM: u32 = 1;
/// Shorter secrets are refused rather than stretched into a false sense of
/// safety. One dashboard-style sentence beats a nine-character word.
pub const MIN_PASSPHRASE: usize = 12;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Header {
    version: u8,
    kdf: String,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    salt: String,
    nonce: String,
    created_at: String,
    #[serde(default)]
    note: String,
}

fn validation(message: impl Into<String>) -> CoreError {
    CoreError::Validation(message.into())
}

fn derive_key(passphrase: &str, salt: &[u8], header: &Header) -> Result<[u8; KEY_LEN]> {
    if passphrase.chars().count() < MIN_PASSPHRASE {
        return Err(validation(format!(
            "Use a passphrase of at least {MIN_PASSPHRASE} characters. It is the only thing protecting the archive."
        )));
    }
    let params = Params::new(
        header.memory_kib,
        header.iterations,
        header.parallelism,
        Some(KEY_LEN),
    )
    .map_err(|_| validation("This archive asks for key settings this build cannot honor."))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_LEN];
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|_| validation("The passphrase could not be stretched into a key."))?;
    Ok(key)
}

/// Seals bytes with a passphrase. Exposed for tests and for callers that hold
/// bytes rather than a connection.
pub fn seal(plain: &[u8], passphrase: &str, note: &str) -> Result<Vec<u8>> {
    if plain.is_empty() {
        return Err(validation("There is nothing to seal."));
    }
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let header = Header {
        version: VERSION,
        kdf: "argon2id".into(),
        memory_kib: MEMORY_KIB,
        iterations: ITERATIONS,
        parallelism: PARALLELISM,
        salt: BASE64.encode(salt),
        nonce: BASE64.encode(nonce),
        created_at: Utc::now().to_rfc3339(),
        note: note.trim().to_string(),
    };
    let key = derive_key(passphrase, &salt, &header)?;
    let encoded = serde_json::to_vec(&header)?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let sealed = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plain,
                aad: &encoded,
            },
        )
        .map_err(|_| validation("The archive could not be written."))?;

    let mut out = Vec::with_capacity(MAGIC.len() + 4 + encoded.len() + sealed.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(encoded.len() as u32).to_le_bytes());
    out.extend_from_slice(&encoded);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Opens an archive. A wrong passphrase and a damaged file are reported apart,
/// because only one of them is worth retyping.
pub fn open(archive: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    if archive.len() < MAGIC.len() + 4 || &archive[..MAGIC.len()] != MAGIC {
        return Err(validation(
            "That file is not a CivicFlow encrypted backup. Choose the file this app wrote.",
        ));
    }
    let length_at = MAGIC.len();
    let header_len = u32::from_le_bytes(
        archive[length_at..length_at + 4]
            .try_into()
            .map_err(|_| validation("That archive is truncated."))?,
    ) as usize;
    let body_at = length_at + 4;
    if archive.len() < body_at + header_len {
        return Err(validation("That archive is truncated."));
    }
    let encoded = &archive[body_at..body_at + header_len];
    let header: Header =
        serde_json::from_slice(encoded).map_err(|_| validation("That archive is damaged."))?;
    if header.version != VERSION || header.kdf != "argon2id" {
        return Err(validation(format!(
            "This archive was written by a newer CivicFlow (format {}). Update this app to open it.",
            header.version
        )));
    }
    let salt = BASE64
        .decode(header.salt.as_bytes())
        .map_err(|_| validation("That archive is damaged."))?;
    let nonce = BASE64
        .decode(header.nonce.as_bytes())
        .map_err(|_| validation("That archive is damaged."))?;
    if nonce.len() != NONCE_LEN {
        return Err(validation("That archive is damaged."));
    }
    let key = derive_key(passphrase, &salt, &header)?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &archive[body_at + header_len..],
                aad: encoded,
            },
        )
        .map_err(|_| {
            validation("That passphrase does not open this archive, or the file was changed.")
        })
}

fn scratch_dir() -> PathBuf {
    let mut bytes = [0u8; 8];
    OsRng.fill_bytes(&mut bytes);
    std::env::temp_dir().join(format!(
        "civicflow-archive-{}",
        BASE64.encode(bytes).replace(['/', '+', '='], "")
    ))
}

/// Snapshots the live database, seals that snapshot, and writes the archive to
/// `target`. The unsealed copy exists only inside a temporary directory that is
/// removed before this returns.
pub fn export(
    conn: &Connection,
    target: &Path,
    passphrase: &str,
    note: &str,
) -> Result<ExportReceipt> {
    if passphrase.chars().count() < MIN_PASSPHRASE {
        return Err(validation(format!(
            "Use a passphrase of at least {MIN_PASSPHRASE} characters."
        )));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let scratch = scratch_dir();
    let result = (|| -> Result<ExportReceipt> {
        let snapshot = backups::create(conn, &scratch, "manual", "Encrypted export")?;
        let bytes = fs::read(scratch.join(&snapshot.id))?;
        let sealed = seal(&bytes, passphrase, note)?;
        fs::write(target, &sealed)?;
        Ok(ExportReceipt {
            path: target.to_string_lossy().to_string(),
            bytes: sealed.len(),
            snapshot: snapshot.id,
            created_at: Utc::now().to_rfc3339(),
        })
    })();
    // The scratch copy is the whole point of the exercise: it must not survive.
    let _ = fs::remove_dir_all(&scratch);
    result
}

/// Opens an archive, proves it is a CivicFlow snapshot, and restores it through
/// the same path a local snapshot takes — so the same validation applies.
pub fn import(
    conn: &mut Connection,
    dir: &Path,
    source: &Path,
    passphrase: &str,
) -> Result<BackupRestoreResult> {
    if !source.is_file() {
        return Err(CoreError::NotFound(format!("Archive {}", source.display())));
    }
    let sealed = fs::read(source)?;
    let plain = open(&sealed, passphrase)?;
    fs::create_dir_all(dir)?;
    let mut bytes = [0u8; 8];
    OsRng.fill_bytes(&mut bytes);
    let id = format!(
        "civicflow-backup-{}-archive-{}.db",
        Utc::now().timestamp_millis(),
        BASE64.encode(bytes).replace(['/', '+', '='], "")
    );
    let staged = dir.join(&id);
    fs::write(&staged, &plain)?;
    if let Err(error) = backups::validate(&staged) {
        let _ = fs::remove_file(&staged);
        return Err(error);
    }
    let restored = match backups::restore(conn, dir, &id) {
        Ok(result) => result,
        Err(error) => {
            // A refused restore must not leave the staged copy behind to be
            // offered as a snapshot later.
            let _ = fs::remove_file(&staged);
            return Err(error);
        }
    };
    let _ = fs::remove_file(&staged);
    Ok(restored)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReceipt {
    pub path: String,
    pub bytes: usize,
    pub snapshot: String,
    pub created_at: String,
}
