//! Shared-workspace synchronization.
//!
//! The contract lives in `protocol`; the SQLite side lives in `replica`. The
//! desktop does not re-implement the network engine: `TauriSyncStore` supplies
//! the same `SyncStore` interface the volunteer app uses, and this crate owns
//! only the durable local replica.

pub mod protocol;
pub mod replica;
