//! Pure-Rust SSH jump-host tunnel client used by Silk's built-in SSH tunnel feature.
//! No Tauri dependency — mirrors `ssm-tunnel-client`'s shape as a plain library crate.
//!
//! Unlike the SSM tunnel (which shells out to the bundled `session-manager-plugin`
//! executable), this crate uses `russh` — a pure-Rust SSH implementation — so there is no
//! external binary to bundle, no PATH/extended-path resolution, and no console-window flash
//! to work around on Windows.

pub mod tunnel;

pub use tunnel::{SshAuth, TunnelManager};
