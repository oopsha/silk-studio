use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Prevents a console window from flashing up for the spawned child on Windows —
/// this is a GUI app with no console of its own to inherit into.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Sets `params.catalog` when non-blank. The jdbc-agent falls back to the connection's current
/// catalog when this is absent — never sends a value that would trigger a session-wide switch.
fn set_optional_catalog(params: &mut Value, catalog: Option<&str>) {
    if let Some(catalog) = catalog {
        let trimmed = catalog.trim();
        if !trimmed.is_empty() {
            params["catalog"] = json!(trimmed);
        }
    }
}

type PendingMap = Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>;

struct AgentIo {
    stdin: Mutex<ChildStdin>,
    next_id: AtomicU64,
    pending: PendingMap,
    /// Live agent session ids (profile ids from the app).
    connected_ids: Mutex<HashSet<String>>,
    child: Mutex<Child>,
    /// Reader thread handle; joined on drop after the child is killed.
    reader: Mutex<Option<JoinHandle<()>>>,
}

/// Thread-safe JDBC agent client. Requests/responses are demultiplexed by id so
/// [`Self::cancel_query`] can run while [`Self::execute_query`] is waiting.
/// Multiple DB sessions are keyed by {@code connection_id}.
pub struct JdbcAgentClient {
    agent_jar: PathBuf,
    java_bin: PathBuf,
    /// Where the jdbc-agent JVM's stderr (uncaught exceptions, native crash traces) is appended.
    /// `None` falls back to inheriting this process's own stderr (visible only when run from a
    /// terminal, e.g. `pnpm tauri dev`) — see `ensure_process`.
    stderr_log: Option<PathBuf>,
    io: Mutex<Option<Arc<AgentIo>>>,
}

impl JdbcAgentClient {
    pub fn new(
        agent_jar: impl Into<PathBuf>,
        java_bin: impl Into<PathBuf>,
        stderr_log: Option<PathBuf>,
    ) -> Self {
        Self {
            agent_jar: agent_jar.into(),
            java_bin: java_bin.into(),
            stderr_log,
            io: Mutex::new(None),
        }
    }

    pub fn agent_jar(&self) -> &PathBuf {
        &self.agent_jar
    }

    pub fn java_bin(&self) -> &PathBuf {
        &self.java_bin
    }

    pub fn connect(
        &self,
        connection_id: &str,
        url: &str,
        user: &str,
        password: &str,
        schema: Option<&str>,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        let connection_id = connection_id.trim();
        if connection_id.is_empty() {
            return Err("connectionId is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id,
            "url": url,
            "user": user,
            "password": password,
        });
        if let Some(schema) = schema {
            let trimmed = schema.trim();
            if !trimmed.is_empty() {
                params["schema"] = json!(trimmed);
            }
        }
        if let Some(catalog) = catalog {
            let trimmed = catalog.trim();
            if !trimmed.is_empty() {
                params["catalog"] = json!(trimmed);
            }
        }
        let result = self.send_request("connection.open", params)?;
        let io = self.ensure_process()?;
        if let Ok(mut ids) = io.connected_ids.lock() {
            ids.insert(connection_id.to_string());
        }
        Ok(result)
    }

    pub fn disconnect(&self, connection_id: &str) -> Result<Value, String> {
        let connection_id = connection_id.trim();
        if connection_id.is_empty() {
            return Err("connectionId is required.".into());
        }
        let result = self.send_request(
            "connection.close",
            json!({ "connectionId": connection_id }),
        )?;
        if let Ok(io) = self.ensure_process() {
            if let Ok(mut ids) = io.connected_ids.lock() {
                ids.remove(connection_id);
            }
        }
        Ok(result)
    }

    pub fn test_connection(
        &self,
        url: &str,
        user: &str,
        password: &str,
        schema: Option<&str>,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        let mut params = json!({
            "url": url,
            "user": user,
            "password": password,
        });
        if let Some(schema) = schema {
            let trimmed = schema.trim();
            if !trimmed.is_empty() {
                params["schema"] = json!(trimmed);
            }
        }
        if let Some(catalog) = catalog {
            let trimmed = catalog.trim();
            if !trimmed.is_empty() {
                params["catalog"] = json!(trimmed);
            }
        }
        self.send_request("connection.test", params)
    }

    pub fn list_metadata(
        &self,
        connection_id: &str,
        schema: Option<&str>,
        catalog: Option<&str>,
        include_secondary_kinds: Option<bool>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let mut params = json!({ "connectionId": connection_id.trim() });
        if let Some(schema) = schema {
            if !schema.trim().is_empty() {
                params["schema"] = json!(schema.trim());
            }
        }
        if let Some(catalog) = catalog {
            if !catalog.trim().is_empty() {
                params["catalog"] = json!(catalog.trim());
            }
        }
        if let Some(include_secondary_kinds) = include_secondary_kinds {
            params["includeSecondaryKinds"] = json!(include_secondary_kinds);
        }
        self.send_request("connection.metadata", params)
    }

    /// Background-prefetch support: fetches every schema's lightweight object list for one
    /// catalog (or, when `catalog` is `None`, every schema in the whole profile — dialects
    /// with no catalog concept) in a single round trip. See `connection.prefetchCatalog` in
    /// jdbc-agent's `Main.java` for why this exists as its own RPC instead of looping
    /// `list_metadata` calls from the caller.
    pub fn prefetch_catalog(
        &self,
        connection_id: &str,
        catalog: Option<&str>,
        max_objects: Option<u32>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let mut params = json!({ "connectionId": connection_id.trim() });
        if let Some(catalog) = catalog {
            if !catalog.trim().is_empty() {
                params["catalog"] = json!(catalog.trim());
            }
        }
        if let Some(max_objects) = max_objects {
            params["maxObjects"] = json!(max_objects);
        }
        self.send_request("connection.prefetchCatalog", params)
    }

    /// `contains`: `None`/`Some(false)` matches `name` exactly (default, preserves existing
    /// callers' behavior); `Some(true)` matches `name` as a case-insensitive substring anywhere
    /// in the object name. See `DbDialect#findObjectsByName` in jdbc-agent for details.
    pub fn find_objects_by_name(
        &self,
        connection_id: &str,
        name: &str,
        contains: Option<bool>,
        kinds: Option<Vec<String>>,
        include_system_objects: Option<bool>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let mut params = json!({ "connectionId": connection_id.trim(), "name": name.trim() });
        if let Some(contains) = contains {
            params["contains"] = json!(contains);
        }
        if let Some(kinds) = kinds {
            if !kinds.is_empty() {
                params["kinds"] = json!(kinds);
            }
        }
        if let Some(include_system_objects) = include_system_objects {
            params["includeSystemObjects"] = json!(include_system_objects);
        }
        self.send_request("connection.findObjectsByName", params)
    }

    pub fn list_columns(
        &self,
        connection_id: &str,
        schema: &str,
        table: &str,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let table = table.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if table.is_empty() {
            return Err("table is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "table": table
        });
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.columns", params)
    }

    /// Parameter list for a standalone stored procedure/function (not a package member) — see
    /// `connection.arguments` in jdbc-agent's `Main.java`.
    pub fn list_arguments(
        &self,
        connection_id: &str,
        schema: &str,
        name: &str,
        kind: &str,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let name = name.trim();
        let kind = kind.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if name.is_empty() {
            return Err("name is required.".into());
        }
        if kind.is_empty() {
            return Err("kind is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "name": name,
            "kind": kind
        });
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.arguments", params)
    }

    pub fn list_package_members(
        &self,
        connection_id: &str,
        schema: &str,
        package: &str,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let package = package.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if package.is_empty() {
            return Err("package is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "package": package
        });
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.packageMembers", params)
    }

    pub fn list_primary_keys(
        &self,
        connection_id: &str,
        schema: &str,
        table: &str,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let table = table.trim();
        if table.is_empty() {
            return Err("table is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema.trim(),
            "table": table
        });
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.primaryKeys", params)
    }

    pub fn list_indexes(
        &self,
        connection_id: &str,
        schema: &str,
        table: &str,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let table = table.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if table.is_empty() {
            return Err("table is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "table": table
        });
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.indexes", params)
    }

    pub fn get_table_comment(
        &self,
        connection_id: &str,
        schema: &str,
        table: &str,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let table = table.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if table.is_empty() {
            return Err("table is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "table": table
        });
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.tableComment", params)
    }

    pub fn list_foreign_keys(
        &self,
        connection_id: &str,
        schema: &str,
        table: &str,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let table = table.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if table.is_empty() {
            return Err("table is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "table": table
        });
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.foreignKeys", params)
    }

    pub fn list_references(
        &self,
        connection_id: &str,
        schema: &str,
        table: &str,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let table = table.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if table.is_empty() {
            return Err("table is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "table": table
        });
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.references", params)
    }

    pub fn list_constraints(
        &self,
        connection_id: &str,
        schema: &str,
        table: &str,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let table = table.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if table.is_empty() {
            return Err("table is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "table": table
        });
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.constraints", params)
    }

    pub fn list_triggers(
        &self,
        connection_id: &str,
        schema: &str,
        table: &str,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let table = table.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if table.is_empty() {
            return Err("table is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "table": table
        });
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.triggers", params)
    }

    pub fn fetch_object_ddl(
        &self,
        connection_id: &str,
        schema: &str,
        name: &str,
        kind: &str,
        package_body: Option<bool>,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let name = name.trim();
        let kind = kind.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if name.is_empty() {
            return Err("object name is required.".into());
        }
        if kind.is_empty() {
            return Err("object kind is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "name": name,
            "kind": kind
        });
        if let Some(package_body) = package_body {
            params["packageBody"] = json!(package_body);
        }
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.ddl", params)
    }

    pub fn compile_object(
        &self,
        connection_id: &str,
        schema: &str,
        name: &str,
        kind: &str,
        package_body: Option<bool>,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let name = name.trim();
        let kind = kind.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if name.is_empty() {
            return Err("object name is required.".into());
        }
        if kind.is_empty() {
            return Err("object kind is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "name": name,
            "kind": kind
        });
        if let Some(package_body) = package_body {
            params["packageBody"] = json!(package_body);
        }
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.compile", params)
    }

    pub fn list_object_dependencies(
        &self,
        connection_id: &str,
        schema: &str,
        name: &str,
        kind: &str,
        package_body: Option<bool>,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let name = name.trim();
        let kind = kind.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if name.is_empty() {
            return Err("object name is required.".into());
        }
        if kind.is_empty() {
            return Err("object kind is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "name": name,
            "kind": kind
        });
        if let Some(package_body) = package_body {
            params["packageBody"] = json!(package_body);
        }
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.dependencies", params)
    }

    pub fn list_object_dependents(
        &self,
        connection_id: &str,
        schema: &str,
        name: &str,
        kind: &str,
        package_body: Option<bool>,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let schema = schema.trim();
        let name = name.trim();
        let kind = kind.trim();
        if schema.is_empty() {
            return Err("schema is required.".into());
        }
        if name.is_empty() {
            return Err("object name is required.".into());
        }
        if kind.is_empty() {
            return Err("object kind is required.".into());
        }
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "schema": schema,
            "name": name,
            "kind": kind
        });
        if let Some(package_body) = package_body {
            params["packageBody"] = json!(package_body);
        }
        set_optional_catalog(&mut params, catalog);
        self.send_request("connection.dependents", params)
    }

    pub fn execute_query(
        &self,
        connection_id: &str,
        sql: &str,
        max_rows: Option<u32>,
        query_timeout_sec: Option<u32>,
        auto_commit: Option<bool>,
        read_only: Option<bool>,
        binds: Option<&[Option<String>]>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "sql": sql
        });
        if let Some(max_rows) = max_rows {
            params["maxRows"] = json!(max_rows);
        }
        if let Some(query_timeout_sec) = query_timeout_sec {
            params["queryTimeoutSec"] = json!(query_timeout_sec);
        }
        if let Some(auto_commit) = auto_commit {
            params["autoCommit"] = json!(auto_commit);
        }
        if let Some(read_only) = read_only {
            params["readOnly"] = json!(read_only);
        }
        if let Some(binds) = binds {
            if !binds.is_empty() {
                params["binds"] = json!(binds);
            }
        }
        self.send_request("query.execute", params)
    }

    /// Re-runs `sql` (the original, unmodified statement text) wrapped with offset/limit
    /// pagination in the connection's own dialect syntax. Backs the large-result scroll feature
    /// (5-D v2) — unlike [`Self::execute_query`], `offset`/`limit` are required, not optional.
    #[allow(clippy::too_many_arguments)]
    pub fn execute_query_paged(
        &self,
        connection_id: &str,
        sql: &str,
        known_columns: &[String],
        offset: u32,
        limit: u32,
        filters: Option<Vec<Value>>,
        sort: Option<Vec<Value>>,
        query_timeout_sec: Option<u32>,
        auto_commit: Option<bool>,
        read_only: Option<bool>,
        binds: Option<&[Option<String>]>,
    ) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let mut params = json!({
            "connectionId": connection_id.trim(),
            "sql": sql,
            "knownColumns": known_columns,
            "offset": offset,
            "limit": limit
        });
        if let Some(filters) = filters {
            if !filters.is_empty() {
                params["filters"] = json!(filters);
            }
        }
        if let Some(sort) = sort {
            if !sort.is_empty() {
                params["sort"] = json!(sort);
            }
        }
        if let Some(query_timeout_sec) = query_timeout_sec {
            params["queryTimeoutSec"] = json!(query_timeout_sec);
        }
        if let Some(auto_commit) = auto_commit {
            params["autoCommit"] = json!(auto_commit);
        }
        if let Some(read_only) = read_only {
            params["readOnly"] = json!(read_only);
        }
        if let Some(binds) = binds {
            if !binds.is_empty() {
                params["binds"] = json!(binds);
            }
        }
        self.send_request("query.executePaged", params)
    }

    /// Cancels the in-flight JDBC statement for {@code connection_id}.
    /// Safe to call while [`Self::execute_query`] waits.
    pub fn cancel_query(&self, connection_id: &str) -> Result<Value, String> {
        let connection_id = connection_id.trim();
        if connection_id.is_empty() {
            return Err("connectionId is required.".into());
        }
        self.ensure_process()?;
        self.send_request(
            "query.cancel",
            json!({ "connectionId": connection_id }),
        )
    }

    /// Commits the open JDBC transaction (`connection.commit`).
    pub fn commit_connection(&self, connection_id: &str) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        self.send_request(
            "connection.commit",
            json!({ "connectionId": connection_id.trim() }),
        )
    }

    /// Rolls back the open JDBC transaction (`connection.rollback`).
    pub fn rollback_connection(&self, connection_id: &str) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        self.send_request(
            "connection.rollback",
            json!({ "connectionId": connection_id.trim() }),
        )
    }

    /// Sets the JDBC session catalog (database) for {@code connection_id}.
    pub fn set_catalog(&self, connection_id: &str, catalog: &str) -> Result<Value, String> {
        self.ensure_connection(connection_id)?;
        let catalog = catalog.trim();
        if catalog.is_empty() {
            return Err("catalog is required.".into());
        }
        self.send_request(
            "connection.setCatalog",
            json!({
                "connectionId": connection_id.trim(),
                "catalog": catalog,
            }),
        )
    }

    fn ensure_connection(&self, connection_id: &str) -> Result<(), String> {
        let connection_id = connection_id.trim();
        if connection_id.is_empty() {
            return Err("connectionId is required.".into());
        }
        let io = self.ensure_process()?;
        let ids = io
            .connected_ids
            .lock()
            .map_err(|_| "Failed to lock jdbc-agent connection set".to_string())?;
        if ids.contains(connection_id) {
            return Ok(());
        }
        Err(format!(
            "No active database connection ({connection_id}). Connect a profile in the Connections explorer."
        ))
    }

    fn ensure_process(&self) -> Result<Arc<AgentIo>, String> {
        {
            let guard = self
                .io
                .lock()
                .map_err(|_| "Failed to lock jdbc-agent process slot".to_string())?;
            if let Some(existing) = guard.as_ref() {
                return Ok(Arc::clone(existing));
            }
        }

        if !self.agent_jar.exists() {
            let agent_dir = self
                .agent_jar
                .parent()
                .map(PathBuf::from)
                .unwrap_or_else(|| self.agent_jar.clone());
            return Err(format!(
                "jdbc-agent jar not found at {}.\n\
For development: cd packages/jdbc-agent && ./gradlew build (Windows: .\\gradlew.bat build)\n\
For release packaging: run scripts/prepare-runtime-resources.mjs before tauri build.\n\
Agent directory: {}",
                self.agent_jar.display(),
                agent_dir.display()
            ));
        }

        if !java_bin_usable(&self.java_bin) {
            return Err(format!(
                "Java runtime not found at {}.\n\
Release builds must include a bundled JRE under resources/jre (see docs/bundled-runtime.md).\n\
For local development, install JDK/JRE 17+ and ensure `java` is on PATH.",
                self.java_bin.display()
            ));
        }

        let stderr_stdio = self
            .stderr_log
            .as_ref()
            .and_then(|path| {
                use std::fs::OpenOptions;
                use std::io::Write;
                let mut file = OpenOptions::new().create(true).append(true).open(path).ok()?;
                let _ = writeln!(
                    file,
                    "\n===== jdbc-agent spawned at {} =====",
                    unix_timestamp_secs()
                );
                Some(Stdio::from(file))
            })
            // No log path resolved (or the file couldn't be opened) — fall back to inheriting
            // this process's own stderr, same as before this was added.
            .unwrap_or_else(Stdio::inherit);

        let mut command = Command::new(&self.java_bin);
        command
            .arg("-Dfile.encoding=UTF-8")
            .arg("-Dsun.jnu.encoding=UTF-8")
            .arg("-jar")
            .arg(&self.agent_jar)
            .arg("--serve")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(stderr_stdio);
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);
        let mut child = command
            .spawn()
            .map_err(|error| {
                format!(
                    "Failed to start jdbc-agent with {} -jar {}: {error}",
                    self.java_bin.display(),
                    self.agent_jar.display()
                )
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture jdbc-agent stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture jdbc-agent stdout".to_string())?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let pending_for_reader = Arc::clone(&pending);

        let reader = thread::spawn(move || {
            let mut stdout = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                match stdout.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {}
                    Err(_) => break,
                }

                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let Ok(parsed) = serde_json::from_str::<Value>(trimmed) else {
                    continue;
                };
                let Some(response_id) = parsed.get("id").and_then(Value::as_u64) else {
                    continue;
                };

                let sender = {
                    let Ok(mut map) = pending_for_reader.lock() else {
                        break;
                    };
                    map.remove(&response_id)
                };

                if let Some(sender) = sender {
                    let _ = sender.send(parse_agent_result(parsed));
                }
            }

            if let Ok(mut map) = pending_for_reader.lock() {
                for (_, sender) in map.drain() {
                    let _ = sender.send(Err("jdbc-agent terminated unexpectedly.".into()));
                }
            }
        });

        let created = Arc::new(AgentIo {
            stdin: Mutex::new(stdin),
            next_id: AtomicU64::new(1),
            pending,
            connected_ids: Mutex::new(HashSet::new()),
            child: Mutex::new(child),
            reader: Mutex::new(Some(reader)),
        });

        let mut guard = self
            .io
            .lock()
            .map_err(|_| "Failed to lock jdbc-agent process slot".to_string())?;
        if let Some(existing) = guard.as_ref() {
            // Lost the startup race — discard this process and use the winner.
            let _ = created.child.lock().map(|mut child| {
                let _ = child.kill();
                let _ = child.wait();
            });
            return Ok(Arc::clone(existing));
        }
        *guard = Some(Arc::clone(&created));
        Ok(created)
    }

    fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let io = self.ensure_process()?;
        let id = io.next_id.fetch_add(1, Ordering::SeqCst);

        let (tx, rx): (Sender<Result<Value, String>>, Receiver<Result<Value, String>>) = channel();
        {
            let mut pending = io
                .pending
                .lock()
                .map_err(|_| "Failed to lock jdbc-agent pending map".to_string())?;
            pending.insert(id, tx);
        }

        let payload = json!({
            "id": id,
            "method": method,
            "params": params,
        })
        .to_string();

        {
            let mut stdin = io
                .stdin
                .lock()
                .map_err(|_| "Failed to lock jdbc-agent stdin".to_string())?;
            stdin
                .write_all(payload.as_bytes())
                .map_err(|error| format!("Failed to write request: {error}"))?;
            stdin
                .write_all(b"\n")
                .map_err(|error| format!("Failed to write request line ending: {error}"))?;
            stdin
                .flush()
                .map_err(|error| format!("Failed to flush request: {error}"))?;
        }

        // Long queries can exceed the DB timeout setting; keep a high ceiling for IPC wait.
        rx.recv_timeout(Duration::from_secs(60 * 60))
            .map_err(|_| "Timed out waiting for jdbc-agent response.".to_string())?
    }
}

fn parse_agent_result(response: Value) -> Result<Value, String> {
    let ok = response
        .get("ok")
        .and_then(Value::as_bool)
        .ok_or_else(|| "Invalid response: missing ok".to_string())?;
    if !ok {
        let message = response
            .get("error")
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Unknown jdbc-agent error");
        return Err(message.to_string());
    }

    Ok(response.get("result").cloned().unwrap_or_else(|| json!({})))
}

fn unix_timestamp_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn java_bin_usable(java_bin: &PathBuf) -> bool {
    if java_bin.is_file() {
        return true;
    }
    // Bare `java` / `java.exe` on PATH — existence is checked at spawn time.
    java_bin.components().count() == 1
}

impl JdbcAgentClient {
    /// Sends `agent.shutdown`, kills the Java subprocess, and joins its reader thread. Callable
    /// from `&self` (the actual mutation goes through `io`'s Mutex) so the app's exit-requested
    /// handler can invoke this explicitly on the shared `AppState` — `Drop` alone isn't enough
    /// since Tauri's runloop doesn't unwind through normal Rust drops on window close.
    pub fn shutdown(&self) {
        let Ok(mut guard) = self.io.lock() else {
            return;
        };
        let Some(io) = guard.take() else {
            return;
        };

        if let Ok(mut stdin) = io.stdin.lock() {
            let _ = stdin.write_all(br#"{"id":0,"method":"agent.shutdown","params":{}}"#);
            let _ = stdin.write_all(b"\n");
            let _ = stdin.flush();
        }

        if let Ok(mut child) = io.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }

        if let Ok(mut reader) = io.reader.lock() {
            if let Some(handle) = reader.take() {
                let _ = handle.join();
            }
        };
    }
}

impl Drop for JdbcAgentClient {
    fn drop(&mut self) {
        self.shutdown();
    }
}
