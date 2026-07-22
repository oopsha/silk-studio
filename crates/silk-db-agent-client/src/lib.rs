use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

struct AgentProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
    connected: bool,
}

pub struct JdbcAgentClient {
    agent_jar: PathBuf,
    process: Option<AgentProcess>,
}

impl JdbcAgentClient {
    pub fn new(agent_jar: impl Into<PathBuf>) -> Self {
        Self {
            agent_jar: agent_jar.into(),
            process: None,
        }
    }

    pub fn connect(
        &mut self,
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
        let result = self.send_request("connection.open", params)?;
        if let Some(process) = self.process.as_mut() {
            process.connected = true;
        }
        Ok(result)
    }

    pub fn disconnect(&mut self) -> Result<Value, String> {
        let result = self.send_request("connection.close", json!({}))?;
        if let Some(process) = self.process.as_mut() {
            process.connected = false;
        }
        Ok(result)
    }

    pub fn test_connection(
        &mut self,
        url: &str,
        user: &str,
        password: &str,
        catalog: Option<&str>,
    ) -> Result<Value, String> {
        let mut params = json!({
            "url": url,
            "user": user,
            "password": password,
        });
        if let Some(catalog) = catalog {
            let trimmed = catalog.trim();
            if !trimmed.is_empty() {
                params["catalog"] = json!(trimmed);
            }
        }
        self.send_request("connection.test", params)
    }

    pub fn list_metadata(&mut self, schema: Option<&str>) -> Result<Value, String> {
        self.ensure_connection()?;
        let mut params = json!({});
        if let Some(schema) = schema {
            if !schema.trim().is_empty() {
                params["schema"] = json!(schema.trim());
            }
        }
        self.send_request("connection.metadata", params)
    }

    pub fn execute_query(
        &mut self,
        sql: &str,
        max_rows: Option<u32>,
        query_timeout_sec: Option<u32>,
        auto_commit: Option<bool>,
        read_only: Option<bool>,
    ) -> Result<Value, String> {
        self.ensure_connection()?;
        let mut params = json!({ "sql": sql });
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
        self.send_request("query.execute", params)
    }

    fn ensure_connection(&mut self) -> Result<(), String> {
        let process = self.ensure_process()?;
        if process.connected {
            return Ok(());
        }

        Err(
            "No active database connection. Connect a profile in the Connections explorer.".into(),
        )
    }

    fn ensure_process(&mut self) -> Result<&mut AgentProcess, String> {
        if self.process.is_none() {
            if !self.agent_jar.exists() {
                let agent_dir = self
                    .agent_jar
                    .parent()
                    .and_then(|path| path.parent())
                    .and_then(|path| path.parent())
                    .map(PathBuf::from)
                    .unwrap_or_else(|| self.agent_jar.clone());
                return Err(format!(
                    "jdbc-agent is not built.\nBuild it first:\ncd {}\nWindows: .\\gradlew.bat build\nmacOS/Linux: ./gradlew build\nThen retry query execution.",
                    agent_dir.display()
                ));
            }

            let mut child = Command::new("java")
                .arg("-Dfile.encoding=UTF-8")
                .arg("-Dsun.jnu.encoding=UTF-8")
                .arg("-jar")
                .arg(&self.agent_jar)
                .arg("--serve")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|error| format!("Failed to start jdbc-agent: {error}"))?;

            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| "Failed to capture jdbc-agent stdin".to_string())?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "Failed to capture jdbc-agent stdout".to_string())?;

            self.process = Some(AgentProcess {
                child,
                stdin,
                stdout: BufReader::new(stdout),
                next_id: 1,
                connected: false,
            });
        }

        self.process
            .as_mut()
            .ok_or_else(|| "Failed to initialize jdbc-agent process".to_string())
    }

    fn send_request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let process = self.ensure_process()?;
        let id = process.next_id;
        process.next_id += 1;

        let payload = json!({
            "id": id,
            "method": method,
            "params": params,
        })
        .to_string();

        process
            .stdin
            .write_all(payload.as_bytes())
            .map_err(|error| format!("Failed to write request: {error}"))?;
        process
            .stdin
            .write_all(b"\n")
            .map_err(|error| format!("Failed to write request line ending: {error}"))?;
        process
            .stdin
            .flush()
            .map_err(|error| format!("Failed to flush request: {error}"))?;

        let mut line = String::new();
        let bytes = process
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("Failed to read response: {error}"))?;

        if bytes == 0 {
            self.process = None;
            return Err("jdbc-agent terminated unexpectedly.".into());
        }

        let response: Value = serde_json::from_str(line.trim())
            .map_err(|error| format!("Invalid response JSON from jdbc-agent: {error}"))?;

        let response_id = response
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Invalid response: missing id".to_string())?;
        if response_id != id {
            return Err(format!(
                "Mismatched response id. expected={id}, actual={response_id}"
            ));
        }

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
}

impl Drop for JdbcAgentClient {
    fn drop(&mut self) {
        if let Some(mut process) = self.process.take() {
            let _ = process
                .stdin
                .write_all(br#"{"id":0,"method":"agent.shutdown","params":{}}"#);
            let _ = process.stdin.write_all(b"\n");
            let _ = process.stdin.flush();
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    }
}
