//! Resolve jdbc-agent jar + Java binary for both packaged installs and monorepo dev.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const AGENT_JAR_NAME: &str = "jdbc-agent-all.jar";
const AGENT_DIR_NAME: &str = "jdbc-agent";
const JRE_DIR_NAME: &str = "jre";
const SSM_PLUGIN_DIR_NAME: &str = "ssm-plugin";

#[derive(Debug, Clone)]
pub struct RuntimePaths {
    pub agent_jar: PathBuf,
    pub java_bin: PathBuf,
    pub agent_bundled: bool,
    pub java_bundled: bool,
    pub ssm_plugin_bin: PathBuf,
    pub ssm_plugin_bundled: bool,
}

pub fn resolve_runtime_paths(app: &AppHandle) -> RuntimePaths {
    let resource_dir = app.path().resource_dir().ok();
    let (agent_jar, agent_bundled) = resolve_agent_jar(resource_dir.as_deref());
    let (java_bin, java_bundled) = resolve_java_bin(resource_dir.as_deref());
    let (ssm_plugin_bin, ssm_plugin_bundled) = resolve_ssm_plugin_bin(resource_dir.as_deref());
    RuntimePaths {
        agent_jar,
        java_bin,
        agent_bundled,
        java_bundled,
        ssm_plugin_bin,
        ssm_plugin_bundled,
    }
}

fn resolve_agent_jar(resource_dir: Option<&Path>) -> (PathBuf, bool) {
    if let Some(dir) = resource_dir {
        let packaged = dir.join(AGENT_DIR_NAME).join(AGENT_JAR_NAME);
        if packaged.is_file() {
            return (packaged, true);
        }
    }

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("jdbc-agent")
        .join("build")
        .join("libs")
        .join(AGENT_JAR_NAME);
    (dev, false)
}

fn resolve_java_bin(resource_dir: Option<&Path>) -> (PathBuf, bool) {
    if let Some(dir) = resource_dir {
        let jre_root = dir.join(JRE_DIR_NAME);
        if let Some(bin) = find_java_bin(&jre_root) {
            return (bin, true);
        }
    }

    (
        PathBuf::from(if cfg!(target_os = "windows") {
            "java.exe"
        } else {
            "java"
        }),
        false,
    )
}

/// Accept both a flattened JRE (`jre/bin/java`) and a raw macOS Adoptium layout
/// (`jre/Contents/Home/bin/java`).
fn find_java_bin(jre_root: &Path) -> Option<PathBuf> {
    let candidates = [
        java_bin_path(jre_root),
        java_bin_path(&jre_root.join("Contents").join("Home")),
        java_bin_path(&jre_root.join("Home")),
    ];
    candidates.into_iter().find(|path| path.is_file())
}

fn java_bin_path(home: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        home.join("bin").join("java.exe")
    } else {
        home.join("bin").join("java")
    }
}

fn resolve_ssm_plugin_bin(resource_dir: Option<&Path>) -> (PathBuf, bool) {
    // AWS's actual installed binary is always lowercase-hyphenated, even on Windows
    // (`C:\Program Files\Amazon\SessionManagerPlugin\bin\session-manager-plugin.exe`) — the
    // PascalCase "SessionManagerPlugin.exe" name only appears on the *installer* inside the
    // downloadable zip, not the runnable plugin itself. See the staging-script note below.
    let bin_name = if cfg!(target_os = "windows") {
        "session-manager-plugin.exe"
    } else {
        "session-manager-plugin"
    };

    if let Some(dir) = resource_dir {
        let packaged = dir.join(SSM_PLUGIN_DIR_NAME).join(bin_name);
        if packaged.is_file() {
            return (packaged, true);
        }
    }

    // Dev fallback: rely on PATH, same convention as the unbundled java fallback.
    (PathBuf::from(bin_name), false)
}

pub fn smoke_check(paths: &RuntimePaths) -> Result<(), String> {
    if !paths.agent_jar.is_file() {
        return Err(format!(
            "jdbc-agent jar missing at {}. Build packages/jdbc-agent or run prepare-runtime-resources.",
            paths.agent_jar.display()
        ));
    }

    if paths.java_bundled {
        if !paths.java_bin.is_file() {
            return Err(format!(
                "Bundled JRE java binary missing at {}.",
                paths.java_bin.display()
            ));
        }
        return Ok(());
    }

    // Dev fallback: PATH java — we cannot prove existence without spawning; OK for smoke.
    Ok(())
}
