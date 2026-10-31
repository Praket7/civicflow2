//! CivicFlow core: authoritative domain rules, SQLite persistence, and read
//! models. The Tauri command layer is a thin wrapper over this crate so the same
//! behaviour is testable without a webview.

pub mod archive;
pub mod auth;
pub mod authorization;
pub mod backups;
pub mod clock;
pub mod db;
pub mod domain;
pub mod error;
pub mod explain;
pub mod imports;
pub mod insights;
pub mod matching;
pub mod models;
pub mod notifications;
pub mod organizations;
pub mod policy;
pub mod recovery;
pub mod recurrence;
pub mod reports;
pub mod roster;
pub mod scope;
pub mod services;
pub mod sync;
pub mod waitlist;
pub mod workflows;

pub use db::{Database, DEMO_SEED};
pub use error::{CoreError, Result};
