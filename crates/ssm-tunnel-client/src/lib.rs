//! AWS SSO login + SSM Session Manager API client used by Silk's built-in SSM tunnel feature.
//! No Tauri dependency — mirrors `silk-db-agent-client`'s shape as a plain library crate.
//!
//! `sso`/`ssm_api` cover the control-plane: SSO login and the SSM API calls (listing
//! instances, starting a session). `tunnel` covers the data-plane: spawning and tracking the
//! bundled `session-manager-plugin` subprocess that actually opens the local TCP tunnel.

pub mod ec2_api;
pub mod sigv4;
pub mod ssm_api;
pub mod sso;
pub mod tunnel;

pub use ec2_api::Ec2Client;
pub use sigv4::AwsCredentials;
pub use ssm_api::{InstanceSummary, SsmClient, StartSessionResult};
pub use sso::{DeviceAuthorization, PollOutcome, RegisteredClient, SsoAccount, SsoAccountRole, SsoOidcClient, SsoPortalClient, SsoToken};
pub use tunnel::TunnelManager;
