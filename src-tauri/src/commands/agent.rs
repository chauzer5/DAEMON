use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::process::Stdio;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use regex::Regex;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};

/// Derive MCP server config JSON from the persona's allowed tools list.
/// Scans for `mcp__<server>__*` prefixes and returns only the servers needed.
fn build_mcp_config(allowed_tools: &Option<Vec<String>>) -> String {
    let tools = match allowed_tools {
        Some(t) if !t.is_empty() => t,
        _ => return r#"{"mcpServers":{}}"#.to_string(),
    };

    // Collect unique MCP server names from tool prefixes
    let mut servers: HashSet<&str> = HashSet::new();
    for tool in tools {
        if let Some(rest) = tool.strip_prefix("mcp__") {
            if let Some(name) = rest.split("__").next() {
                servers.insert(name);
            }
        }
    }

    if servers.is_empty() {
        return r#"{"mcpServers":{}}"#.to_string();
    }

    // Known MCP server configurations
    let mut mcp_servers: Vec<String> = Vec::new();

    if servers.contains("datadog-mcp") {
        mcp_servers.push(r#""datadog-mcp":{"type":"http","url":"https://mcp.datadoghq.com/api/unstable/mcp-server/mcp"}"#.into());
    }
    if servers.contains("linear-server") {
        mcp_servers.push(r#""linear-server":{"command":"npx","args":["-y","linear-mcp-server"]}"#.into());
    }
    if servers.contains("figma") {
        mcp_servers.push(r#""figma":{"type":"http","url":"https://mcp.figma.com/mcp"}"#.into());
    }
    if servers.contains("playwright") {
        mcp_servers.push(r#""playwright":{"command":"npx","args":["-y","@playwright/mcp@0.0.42"]}"#.into());
    }
    if servers.contains("launchdarkly") {
        if let Ok(Some(ld_key)) = crate::services::credentials::get_credential("launchdarkly_api_key") {
            mcp_servers.push(format!(
                r#""launchdarkly":{{"command":"npx","args":["-y","--package","@launchdarkly/mcp-server","--","mcp","start","--api-key","{}"]}}"#,
                ld_key
            ));
        }
    }

    format!(r#"{{"mcpServers":{{{}}}}}"#, mcp_servers.join(","))
}

// Global PTY registry — maps pty_id to (master, child)
static PTY_REGISTRY: Lazy<Mutex<HashMap<String, PtyHandle>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// Global agent process registry — maps task_id to child process handle
static AGENT_REGISTRY: Lazy<Mutex<HashMap<String, tokio::process::Child>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// PID registry for std::process children (used by run_interactive_agent)
static PID_REGISTRY: Lazy<Mutex<HashMap<String, u32>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// Writer registry for interactive agents — maps pty_id to a reusable writer
static PTY_WRITER_REGISTRY: Lazy<Mutex<HashMap<String, Box<dyn std::io::Write + Send>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// Session ID registry — maps task_id to Claude CLI session_id for --resume
static SESSION_REGISTRY: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// MCP config registry — maps task_id to the MCP config JSON used at spawn
static MCP_CONFIG_REGISTRY: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// MCP failure counter — maps "task_id:server_name" to consecutive failure count
static MCP_FAILURE_COUNTS: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// Recovery attempt counter — maps task_id to number of recovery attempts
static RECOVERY_COUNTS: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

struct PtyHandle {
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

#[derive(Clone, serde::Serialize)]
struct AgentOutput {
    task_id: String,
    line: String,
    done: bool,
}

#[derive(Clone, serde::Serialize)]
struct AgentQuestion {
    task_id: String,
    question: String,
}

#[derive(Clone, serde::Serialize)]
struct AgentTurnComplete {
    task_id: String,
}

#[derive(Clone, serde::Serialize)]
struct McpFailureEvent {
    task_id: String,
    server_name: String,
    error_message: String,
    failure_count: u32,
    is_critical: bool,
}

/// Inject all relevant API keys as env vars so agents can fall back to curl
fn inject_all_api_keys(cmd: &mut tokio::process::Command) {
    if let Ok(Some(v)) = crate::services::credentials::get_credential("dd_api_key") {
        cmd.env("DD_API_KEY", &v);
    }
    if let Ok(Some(v)) = crate::services::credentials::get_credential("dd_app_key") {
        cmd.env("DD_APP_KEY", &v);
    }
    if let Ok(Some(v)) = crate::services::credentials::get_credential("linear_api_key") {
        cmd.env("LINEAR_API_KEY", &v);
    }
    if let Ok(Some(v)) = crate::services::credentials::get_credential("gitlab_pat") {
        cmd.env("GITLAB_PAT", &v);
    }
    if let Ok(Some(v)) = crate::services::credentials::get_credential("launchdarkly_api_key") {
        cmd.env("LAUNCHDARKLY_API_KEY", &v);
    }
}

/// Extract MCP server name from a tool name like "mcp__datadog-mcp__search_monitors"
fn mcp_server_from_tool(tool_name: &str) -> Option<String> {
    tool_name.strip_prefix("mcp__").and_then(|rest| {
        rest.split("__").next().map(|s| s.to_string())
    })
}

/// Check if an error message looks like an MCP connection failure
fn is_mcp_connection_error(msg: &str) -> bool {
    let patterns = [
        "connection refused", "server disconnected", "transport error",
        "ECONNRESET", "ECONNREFUSED", "EPIPE", "timeout", "502", "503",
        "not available", "not connected", "unavailable", "MCP server",
        "failed to connect", "connection closed", "broken pipe",
    ];
    let lower = msg.to_lowercase();
    patterns.iter().any(|p| lower.contains(&p.to_lowercase()))
}

/// Record an MCP tool failure, return (failure_count, is_critical)
fn record_mcp_failure(task_id: &str, server_name: &str) -> (u32, bool) {
    let key = format!("{}:{}", task_id, server_name);
    let mut counts = MCP_FAILURE_COUNTS.lock().unwrap();
    let count = counts.entry(key).or_insert(0);
    *count += 1;
    let c = *count;
    (c, c >= 3)
}

/// Reset MCP failure count for a server (e.g., when a tool succeeds)
fn reset_mcp_failure(task_id: &str, server_name: &str) {
    let key = format!("{}:{}", task_id, server_name);
    let mut counts = MCP_FAILURE_COUNTS.lock().unwrap();
    counts.remove(&key);
}

/// Build the fallback instructions message for an agent whose MCP server is down
fn mcp_fallback_instructions(server_name: &str) -> String {
    let api_hint = match server_name {
        "datadog-mcp" => "Use env vars DD_API_KEY and DD_APP_KEY with curl against https://api.datadoghq.com/api/v1 and /api/v2",
        "linear-server" => "Use env var LINEAR_API_KEY as Authorization header with curl against https://api.linear.app/graphql",
        "launchdarkly" => "Use env var LAUNCHDARKLY_API_KEY as Authorization header with curl against https://app.launchdarkly.com/api/v2",
        "figma" => "Figma MCP is OAuth-based; fallback to direct API is not available",
        "playwright" => "Playwright MCP failed; browser automation is not available via fallback",
        _ => "Check environment variables for available API keys",
    };
    format!(
        "IMPORTANT: The {} MCP server has disconnected and tools prefixed with mcp__{}__ are unavailable. \
         Fall back to direct API calls via curl using the Bash tool. {}. \
         Do NOT attempt to use mcp__{}__ tools — they will fail.",
        server_name, server_name, api_hint, server_name
    )
}

#[derive(Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOptions {
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub denied_tools: Option<Vec<String>>,
    pub max_budget_usd: Option<f64>,
    pub disable_slash_commands: Option<bool>,
}

#[tauri::command]
pub async fn run_agent_command(
    app: tauri::AppHandle,
    task_id: String,
    command: String,
    args: String,
    model: Option<String>,
    options: Option<AgentOptions>,
) -> Result<(), String> {
    let opts = options.unwrap_or_default();

    let mut cmd = tokio::process::Command::new("/Users/ajholloway/.local/bin/claude");
    cmd.current_dir("/Users/ajholloway/Programming");

    // Disable OTEL telemetry to prevent 1Password blocking
    cmd.env("CLAUDE_CODE_ENABLE_TELEMETRY", "0");
    cmd.env("OTEL_METRICS_EXPORTER", "");
    cmd.env("OTEL_LOGS_EXPORTER", "");
    cmd.env("OTEL_EXPORTER_OTLP_ENDPOINT", "");

    cmd.arg("--print");
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--verbose");
    cmd.arg("--include-partial-messages");

    // Disable otelHeadersHelper; derive MCP config from allowed tools
    cmd.arg("--settings").arg(r#"{"otelHeadersHelper":""}"#);
    let mcp_config = build_mcp_config(&opts.allowed_tools);
    cmd.arg("--mcp-config").arg(&mcp_config);
    cmd.arg("--strict-mcp-config");

    // Store MCP config for resume/recovery
    {
        let mut mcp_reg = MCP_CONFIG_REGISTRY.lock().unwrap();
        mcp_reg.insert(task_id.clone(), mcp_config.clone());
    }

    // Inject all API keys so agents can fall back to curl if MCP servers disconnect
    inject_all_api_keys(&mut cmd);

    // Model: options.model takes precedence over top-level model param
    let effective_model = opts.model.as_deref().or(model.as_deref());
    if let Some(m) = effective_model {
        let model_id = match m {
            "opus" => "claude-opus-4-6",
            "haiku" => "claude-haiku-4-5-20251001",
            _ => "claude-sonnet-4-6",
        };
        cmd.arg("--model").arg(model_id);
    }

    // System prompt — passed separately so the user prompt stays clean
    if let Some(ref sp) = opts.system_prompt {
        cmd.arg("--system-prompt").arg(sp);
    }

    // Allowed tools
    if let Some(ref tools) = opts.allowed_tools {
        if !tools.is_empty() {
            cmd.arg("--allowedTools").args(tools);
        }
    }

    // Denied tools
    if let Some(ref tools) = opts.denied_tools {
        if !tools.is_empty() {
            cmd.arg("--disallowedTools").args(tools);
        }
    }

    // Budget cap
    if let Some(budget) = opts.max_budget_usd {
        cmd.arg("--max-budget-usd").arg(budget.to_string());
    }

    // Disable slash commands for agents that don't need them
    if opts.disable_slash_commands.unwrap_or(false) {
        cmd.arg("--disable-slash-commands");
    }

    // Bypass permission prompts — agents run with explicit tool constraints
    // so the allowed/denied tool lists are the permission boundary
    cmd.arg("--dangerously-skip-permissions");

    // The actual user prompt (command + args)
    let prompt = if args.trim().is_empty() {
        command.clone()
    } else {
        format!("{} {}", command, args)
    };

    cmd.arg(&prompt);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take().ok_or("No stderr")?;

    // Store the child process so it can be killed on cancel
    {
        let mut registry = AGENT_REGISTRY.lock().unwrap();
        registry.insert(task_id.clone(), child);
    }

    let app_clone = app.clone();
    let tid = task_id.clone();

    // Stream stdout — parse stream-json events for text deltas and tool use.
    // Accumulates full text to detect question blocks at the end.
    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut full_text = String::new();

        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                let msg_type = json["type"].as_str().unwrap_or("");

                match msg_type {
                    "stream_event" => {
                        let event_type = json["event"]["type"].as_str().unwrap_or("");
                        if event_type == "content_block_delta" {
                            if let Some(text) = json["event"]["delta"]["text"].as_str() {
                                full_text.push_str(text);
                                let _ = app_clone.emit(
                                    "agent-output",
                                    AgentOutput {
                                        task_id: tid.clone(),
                                        line: text.to_string(),
                                        done: false,
                                    },
                                );
                            }
                        }
                    }
                    // Tool use — emit a summary line so the timeline shows what the agent did
                    "tool_use" => {
                        let tool_name = json["name"].as_str().unwrap_or("tool");
                        let input = &json["input"];
                        let summary = match tool_name {
                            "Edit" | "Write" => {
                                let path = input["file_path"].as_str().unwrap_or("?");
                                // Show just the filename, not the full path
                                let short = path.rsplit('/').next().unwrap_or(path);
                                format!("\n`{}` → **{}**\n", tool_name, short)
                            }
                            "Bash" => {
                                let cmd_str = input["command"].as_str().unwrap_or("...");
                                let truncated = if cmd_str.chars().count() > 120 {
                                    let s: String = cmd_str.chars().take(120).collect();
                                    format!("{}...", s)
                                } else {
                                    cmd_str.to_string()
                                };
                                format!("\n`$ {}`\n", truncated)
                            }
                            "Read" | "Glob" | "Grep" => {
                                // Skip read-only tools to reduce noise
                                String::new()
                            }
                            _ => {
                                format!("\n`{}`\n", tool_name)
                            }
                        };
                        if !summary.is_empty() {
                            full_text.push_str(&summary);
                            let _ = app_clone.emit(
                                "agent-output",
                                AgentOutput {
                                    task_id: tid.clone(),
                                    line: summary,
                                    done: false,
                                },
                            );
                        }
                    }
                    // Tool result — emit errors so they're visible
                    "tool_result" => {
                        let is_error = json["is_error"].as_bool().unwrap_or(false);
                        if is_error {
                            let content = json["content"].as_str()
                                .or_else(|| json["output"].as_str())
                                .unwrap_or("Unknown error");
                            let truncated = if content.chars().count() > 300 {
                                let s: String = content.chars().take(300).collect();
                                format!("{}...", s)
                            } else {
                                content.to_string()
                            };
                            let msg = format!("\n> **Error**: {}\n", truncated);
                            full_text.push_str(&msg);
                            let _ = app_clone.emit(
                                "agent-output",
                                AgentOutput {
                                    task_id: tid.clone(),
                                    line: msg,
                                    done: false,
                                },
                            );
                        }
                    }
                    "result" => {
                        // Capture session_id for potential --resume later
                        if let Some(sid) = json["session_id"].as_str() {
                            let mut reg = SESSION_REGISTRY.lock().unwrap();
                            reg.insert(tid.clone(), sid.to_string());
                        }
                    }
                    _ => {}
                }
            }
        }

        // Detect question blocks in the accumulated text
        let question_re = Regex::new(
            r"(?m)^#{2,3}\s*Question(?:\s+for\s+User)?\s*\n([\s\S]*?)(?:\n#{2,3}\s|\z)"
        ).unwrap();
        if let Some(caps) = question_re.captures(&full_text) {
            let question_text: String = caps[1]
                .lines()
                .filter(|l| !l.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            if !question_text.is_empty() {
                let _ = app_clone.emit(
                    "agent-question",
                    AgentQuestion {
                        task_id: tid.clone(),
                        question: question_text,
                    },
                );
            }
        }
    });

    let app_clone2 = app.clone();
    let tid2 = task_id.clone();

    // Stream stderr
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_clone2.emit(
                "agent-output",
                AgentOutput {
                    task_id: tid2.clone(),
                    line: format!("[stderr] {}", line),
                    done: false,
                },
            );
        }
    });

    // Wait for completion
    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

    // Retrieve the child process from registry (release lock immediately)
    let maybe_child = {
        let mut registry = AGENT_REGISTRY.lock().unwrap();
        registry.remove(&task_id)
    };

    // Wait on the child process
    let status = match maybe_child {
        Some(mut child) => child.wait().await.map_err(|e| e.to_string())?,
        None => {
            // Process was killed via kill_agent_command — emit done and return
            let _ = app.emit(
                "agent-output",
                AgentOutput {
                    task_id: task_id.clone(),
                    line: "✗ Cancelled".to_string(),
                    done: true,
                },
            );
            return Ok(());
        }
    };

    let _ = app.emit(
        "agent-output",
        AgentOutput {
            task_id: task_id.clone(),
            line: if status.success() {
                "✓ Command completed".to_string()
            } else {
                format!("✗ Exited with code {}", status.code().unwrap_or(-1))
            },
            done: true,
        },
    );

    Ok(())
}

/// Respond to an interactive agent by spawning a new Claude CLI process
/// with --resume to continue the conversation.
#[tauri::command]
pub async fn respond_to_agent(
    app: tauri::AppHandle,
    task_id: String,
    _question_id: Option<String>,
    response: String,
) -> Result<(), String> {
    let session_id = {
        let reg = SESSION_REGISTRY.lock().unwrap();
        reg.get(&task_id).cloned()
    };

    let session_id = session_id.ok_or_else(|| {
        "No session_id found for this conversation — cannot resume".to_string()
    })?;

    let mut cmd = tokio::process::Command::new("/Users/ajholloway/.local/bin/claude");
    cmd.current_dir("/Users/ajholloway/Programming");

    // Disable OTEL telemetry
    cmd.env("CLAUDE_CODE_ENABLE_TELEMETRY", "0");
    cmd.env("OTEL_METRICS_EXPORTER", "");
    cmd.env("OTEL_LOGS_EXPORTER", "");
    cmd.env("OTEL_EXPORTER_OTLP_ENDPOINT", "");

    cmd.arg("--print");
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--verbose");
    cmd.arg("--include-partial-messages");

    cmd.arg("--settings").arg(r#"{"otelHeadersHelper":""}"#);

    // Restore the MCP config from the original spawn (fixes bug where resume lost all MCP)
    let mcp_config = {
        let mcp_reg = MCP_CONFIG_REGISTRY.lock().unwrap();
        mcp_reg.get(&task_id).cloned()
            .unwrap_or_else(|| r#"{"mcpServers":{}}"#.to_string())
    };
    cmd.arg("--mcp-config").arg(&mcp_config);
    cmd.arg("--strict-mcp-config");

    // Inject all API keys for curl fallback
    inject_all_api_keys(&mut cmd);

    cmd.arg("--resume").arg(&session_id);
    cmd.arg("--dangerously-skip-permissions");
    cmd.arg(&response);

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn claude --resume: {}", e))?;

    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take().ok_or("No stderr")?;

    // Store in registry so it can be killed
    {
        let mut registry = AGENT_REGISTRY.lock().unwrap();
        registry.insert(task_id.clone(), child);
    }

    let app_clone = app.clone();
    let tid = task_id.clone();

    // Stream stdout (with MCP health detection)
    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut last_mcp_tool_server: Option<String> = None;

        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                let msg_type = json["type"].as_str().unwrap_or("");

                match msg_type {
                    "stream_event" => {
                        let event_type = json["event"]["type"].as_str().unwrap_or("");
                        if event_type == "content_block_delta" {
                            if let Some(text) = json["event"]["delta"]["text"].as_str() {
                                let _ = app_clone.emit(
                                    "agent-output",
                                    AgentOutput {
                                        task_id: tid.clone(),
                                        line: text.to_string(),
                                        done: false,
                                    },
                                );
                            }
                        }
                    }
                    "tool_use" => {
                        if let Some(name) = json["tool_name"].as_str()
                            .or_else(|| json["name"].as_str())
                        {
                            last_mcp_tool_server = mcp_server_from_tool(name);
                        }
                    }
                    "tool_result" => {
                        let is_error = json["is_error"].as_bool().unwrap_or(false);
                        let content = json["content"].as_str()
                            .or_else(|| json["error"].as_str())
                            .unwrap_or("");
                        if let Some(ref server) = last_mcp_tool_server {
                            if is_error && is_mcp_connection_error(content) {
                                let (count, critical) = record_mcp_failure(&tid, server);
                                let _ = app_clone.emit("mcp-failure", McpFailureEvent {
                                    task_id: tid.clone(),
                                    server_name: server.clone(),
                                    error_message: content.chars().take(200).collect(),
                                    failure_count: count,
                                    is_critical: critical,
                                });
                            } else if !is_error {
                                reset_mcp_failure(&tid, server);
                            }
                        }
                        last_mcp_tool_server = None;
                    }
                    "result" => {
                        // Update session_id in case it changed
                        if let Some(sid) = json["session_id"].as_str() {
                            let mut reg = SESSION_REGISTRY.lock().unwrap();
                            reg.insert(tid.clone(), sid.to_string());
                        }
                    }
                    _ => {}
                }
            }
        }
    });

    let app_clone2 = app.clone();
    let tid2 = task_id.clone();

    // Stream stderr
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_clone2.emit(
                "agent-output",
                AgentOutput {
                    task_id: tid2.clone(),
                    line: format!("[stderr] {}", line),
                    done: false,
                },
            );
        }
    });

    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

    // Wait on child
    let maybe_child = {
        let mut registry = AGENT_REGISTRY.lock().unwrap();
        registry.remove(&task_id)
    };

    if let Some(mut child) = maybe_child {
        let _ = child.wait().await;
    }

    // Emit done — the frontend will transition back to "waiting"
    let _ = app.emit(
        "agent-output",
        AgentOutput {
            task_id: task_id.clone(),
            line: String::new(),
            done: true,
        },
    );

    Ok(())
}

/// Kill a running agent command process.
#[tauri::command]
pub async fn kill_agent_command(task_id: String) -> Result<(), String> {
    // Try tokio process registry first (run_agent_command)
    let child = {
        let mut registry = AGENT_REGISTRY.lock().unwrap();
        registry.remove(&task_id)
    };
    if let Some(mut child) = child {
        let _ = child.start_kill();
        let _ = child.wait().await;
        return Ok(());
    }

    // Try PID registry (run_interactive_agent with std::process)
    let pid = {
        let mut pid_reg = PID_REGISTRY.lock().unwrap();
        pid_reg.remove(&task_id)
    };
    if let Some(pid) = pid {
        // Kill the process tree
        let _ = std::process::Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status();
        // Also clean up the writer so respond_to_agent stops
        let mut writer_reg = PTY_WRITER_REGISTRY.lock().unwrap();
        writer_reg.remove(&task_id);
    }
    Ok(())
}

/// Spawn Claude CLI in a real PTY for full terminal output with ANSI colors.
#[tauri::command]
pub async fn spawn_agent_pty(
    app: tauri::AppHandle,
    pty_id: String,
    command: String,
    args: String,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let prompt = if args.trim().is_empty() {
        command.clone()
    } else {
        format!("{} {}", command, args)
    };

    let mut cmd = CommandBuilder::new("/Users/ajholloway/.local/bin/claude");
    cmd.arg("--print");
    cmd.arg(&prompt);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn in PTY: {}", e))?;

    // Get a reader from the master side
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    // Store the PTY handle
    {
        let mut registry = PTY_REGISTRY.lock().unwrap();
        registry.insert(
            pty_id.clone(),
            PtyHandle {
                master: pair.master,
                child,
            },
        );
    }

    // Stream PTY output in a background thread
    let app_clone = app.clone();
    let pid = pty_id.clone();
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "agent-output",
                        AgentOutput {
                            task_id: pid.clone(),
                            line: text,
                            done: false,
                        },
                    );
                }
                Err(_) => break,
            }
        }

        // Signal completion
        let _ = app_clone.emit(
            "agent-output",
            AgentOutput {
                task_id: pid.clone(),
                line: String::new(),
                done: true,
            },
        );

        // Cleanup
        let mut registry = PTY_REGISTRY.lock().unwrap();
        registry.remove(&pid);
    });

    Ok(())
}

/// Write input to a running PTY.
#[tauri::command]
pub async fn write_agent_pty(pty_id: String, data: String) -> Result<(), String> {
    let mut registry = PTY_REGISTRY.lock().unwrap();
    if let Some(handle) = registry.get_mut(&pty_id) {
        let mut writer = handle
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get writer: {}", e))?;
        use std::io::Write;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write: {}", e))?;
        Ok(())
    } else {
        Err(format!("PTY {} not found", pty_id))
    }
}

/// Kill a running PTY process.
#[tauri::command]
pub async fn kill_agent_pty(pty_id: String) -> Result<(), String> {
    let handle = {
        let mut registry = PTY_REGISTRY.lock().unwrap();
        registry.remove(&pty_id)
    };
    // Also clean up the writer registry
    {
        let mut writer_reg = PTY_WRITER_REGISTRY.lock().unwrap();
        writer_reg.remove(&pty_id);
    }
    if let Some(mut handle) = handle {
        let _ = handle.child.kill();
        Ok(())
    } else {
        Err(format!("PTY {} not found", pty_id))
    }
}

/// Spawn Claude CLI as an interactive agent using the same tokio::process pattern
/// as run_agent_command (which is proven to work), but with stream-json output
/// for structured streaming and MCP/OTEL isolation.
/// Blocks until the process completes (same as run_agent_command).
#[tauri::command]
pub async fn run_interactive_agent(
    app: tauri::AppHandle,
    task_id: String,
    command: String,
    args: String,
    options: Option<AgentOptions>,
) -> Result<(), String> {
    let opts = options.unwrap_or_default();

    let mut cmd = tokio::process::Command::new("/Users/ajholloway/.local/bin/claude");
    cmd.current_dir("/Users/ajholloway/Programming");

    // Disable OTEL telemetry to prevent 1Password blocking
    cmd.env("CLAUDE_CODE_ENABLE_TELEMETRY", "0");
    cmd.env("OTEL_METRICS_EXPORTER", "");
    cmd.env("OTEL_LOGS_EXPORTER", "");
    cmd.env("OTEL_EXPORTER_OTLP_ENDPOINT", "");

    cmd.arg("--print");
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--verbose");
    cmd.arg("--include-partial-messages");

    // Disable otelHeadersHelper; derive MCP config from allowed tools
    cmd.arg("--settings").arg(r#"{"otelHeadersHelper":""}"#);
    let mcp_config = build_mcp_config(&opts.allowed_tools);
    cmd.arg("--mcp-config").arg(&mcp_config);
    cmd.arg("--strict-mcp-config");

    // Store MCP config for resume/recovery
    {
        let mut mcp_reg = MCP_CONFIG_REGISTRY.lock().unwrap();
        mcp_reg.insert(task_id.clone(), mcp_config.clone());
    }

    // Inject all API keys so agents can fall back to curl if MCP servers disconnect
    inject_all_api_keys(&mut cmd);

    // Model
    let effective_model = opts.model.as_deref();
    if let Some(m) = effective_model {
        let model_id = match m {
            "opus" => "claude-opus-4-6",
            "haiku" => "claude-haiku-4-5-20251001",
            _ => "claude-sonnet-4-6",
        };
        cmd.arg("--model").arg(model_id);
    }

    if let Some(ref sp) = opts.system_prompt {
        cmd.arg("--system-prompt").arg(sp);
    }

    if let Some(ref tools) = opts.allowed_tools {
        if !tools.is_empty() {
            cmd.arg("--allowedTools").args(tools);
        }
    }

    if let Some(ref tools) = opts.denied_tools {
        if !tools.is_empty() {
            cmd.arg("--disallowedTools").args(tools);
        }
    }

    if let Some(budget) = opts.max_budget_usd {
        cmd.arg("--max-budget-usd").arg(budget.to_string());
    }

    if opts.disable_slash_commands.unwrap_or(false) {
        cmd.arg("--disable-slash-commands");
    }

    cmd.arg("--dangerously-skip-permissions");

    let prompt = if args.trim().is_empty() {
        command.clone()
    } else {
        format!("{} {}", command, args)
    };
    cmd.arg(&prompt);

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take().ok_or("No stderr")?;

    // Store the child process so it can be killed
    {
        let mut registry = AGENT_REGISTRY.lock().unwrap();
        registry.insert(task_id.clone(), child);
    }

    let app_clone = app.clone();
    let tid = task_id.clone();

    // Stream stdout — parse stream-json events for text deltas + MCP health
    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        // Track the last MCP tool use for correlating with tool_result errors
        let mut last_mcp_tool_server: Option<String> = None;

        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                let msg_type = json["type"].as_str().unwrap_or("");

                match msg_type {
                    "stream_event" => {
                        let event_type = json["event"]["type"].as_str().unwrap_or("");
                        if event_type == "content_block_delta" {
                            if let Some(text) = json["event"]["delta"]["text"].as_str() {
                                let _ = app_clone.emit(
                                    "agent-output",
                                    AgentOutput {
                                        task_id: tid.clone(),
                                        line: text.to_string(),
                                        done: false,
                                    },
                                );
                            }
                        }
                    }
                    // Layer 2: MCP health detection — track tool_use/tool_result pairs
                    "tool_use" => {
                        if let Some(name) = json["tool_name"].as_str()
                            .or_else(|| json["name"].as_str())
                        {
                            last_mcp_tool_server = mcp_server_from_tool(name);
                        }
                    }
                    "tool_result" => {
                        let is_error = json["is_error"].as_bool().unwrap_or(false);
                        let content = json["content"].as_str()
                            .or_else(|| json["error"].as_str())
                            .unwrap_or("");

                        if let Some(ref server) = last_mcp_tool_server {
                            if is_error && is_mcp_connection_error(content) {
                                let (count, critical) = record_mcp_failure(&tid, server);
                                let _ = app_clone.emit("mcp-failure", McpFailureEvent {
                                    task_id: tid.clone(),
                                    server_name: server.clone(),
                                    error_message: content.chars().take(200).collect(),
                                    failure_count: count,
                                    is_critical: critical,
                                });
                            } else if !is_error {
                                // Tool succeeded — reset failure count
                                reset_mcp_failure(&tid, server);
                            }
                        }
                        last_mcp_tool_server = None;
                    }
                    "assistant" => {
                        // Full message — already streamed via deltas
                    }
                    "result" => {
                        // Capture session_id for --resume follow-ups
                        if let Some(sid) = json["session_id"].as_str() {
                            let mut reg = SESSION_REGISTRY.lock().unwrap();
                            reg.insert(tid.clone(), sid.to_string());
                        }
                    }
                    _ => {}
                }
            } else {
                // Non-JSON line — emit as-is (like run_agent_command does)
                let _ = app_clone.emit(
                    "agent-output",
                    AgentOutput {
                        task_id: tid.clone(),
                        line,
                        done: false,
                    },
                );
            }
        }
    });

    let app_clone2 = app.clone();
    let tid2 = task_id.clone();

    // Stream stderr
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_clone2.emit(
                "agent-output",
                AgentOutput {
                    task_id: tid2.clone(),
                    line: format!("[stderr] {}", line),
                    done: false,
                },
            );
        }
    });

    // Wait for streams to finish
    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

    // Retrieve and wait on child process
    let maybe_child = {
        let mut registry = AGENT_REGISTRY.lock().unwrap();
        registry.remove(&task_id)
    };

    let status = match maybe_child {
        Some(mut child) => child.wait().await.map_err(|e| e.to_string())?,
        None => {
            let _ = app.emit(
                "agent-output",
                AgentOutput {
                    task_id: task_id.clone(),
                    line: String::new(),
                    done: true,
                },
            );
            return Ok(());
        }
    };

    let _ = app.emit(
        "agent-output",
        AgentOutput {
            task_id: task_id.clone(),
            line: String::new(),
            done: true,
        },
    );

    Ok(())
}

// ── Layer 3: MCP Recovery ──────────────────────────────────────────

/// Recover an agent's MCP server connection.
///
/// Priority hierarchy:
/// 1. "resume"   — Kill agent, restart with --resume and fresh MCP connections
/// 2. "fallback" — Resume with curl instructions (no MCP servers)
///
/// Auto-escalates to fallback after 2 failed resume attempts.
#[tauri::command]
pub async fn recover_mcp_agent(
    app: tauri::AppHandle,
    task_id: String,
    server_name: String,
    strategy: String,
) -> Result<String, String> {
    let attempt = {
        let mut counts = RECOVERY_COUNTS.lock().unwrap();
        let count = counts.entry(task_id.clone()).or_insert(0);
        *count += 1;
        *count
    };

    let effective = if strategy == "resume" && attempt > 2 { "fallback" } else { &strategy };

    let session_id = SESSION_REGISTRY.lock().unwrap().get(&task_id).cloned()
        .ok_or("No session_id — cannot recover")?;

    match effective {
        "resume" => {
            let _ = kill_agent_command(task_id.clone()).await;
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            let mcp_config = MCP_CONFIG_REGISTRY.lock().unwrap().get(&task_id).cloned()
                .unwrap_or_else(|| r#"{"mcpServers":{}}"#.to_string());

            let mut cmd = tokio::process::Command::new("/Users/ajholloway/.local/bin/claude");
            cmd.current_dir("/Users/ajholloway/Programming");
            cmd.env("CLAUDE_CODE_ENABLE_TELEMETRY", "0");
            cmd.env("OTEL_METRICS_EXPORTER", "");
            cmd.env("OTEL_LOGS_EXPORTER", "");
            cmd.env("OTEL_EXPORTER_OTLP_ENDPOINT", "");
            inject_all_api_keys(&mut cmd);
            cmd.arg("--print").arg("--output-format").arg("stream-json");
            cmd.arg("--verbose").arg("--include-partial-messages");
            cmd.arg("--settings").arg(r#"{"otelHeadersHelper":""}"#);
            cmd.arg("--mcp-config").arg(&mcp_config);
            cmd.arg("--strict-mcp-config");
            cmd.arg("--resume").arg(&session_id);
            cmd.arg("--dangerously-skip-permissions");
            cmd.arg(format!(
                "The {} MCP server disconnected. A fresh connection has been established. \
                 Retry the failed operation. If tools still fail, fall back to curl with env vars.",
                server_name
            ));
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

            let mut child = cmd.spawn().map_err(|e| format!("Resume failed: {}", e))?;
            let stdout = child.stdout.take().ok_or("No stdout")?;
            let stderr = child.stderr.take().ok_or("No stderr")?;
            AGENT_REGISTRY.lock().unwrap().insert(task_id.clone(), child);
            reset_mcp_failure(&task_id, &server_name);

            let app_c = app.clone();
            let tid = task_id.clone();
            let sh = tokio::spawn(async move {
                let r = BufReader::new(stdout);
                let mut lines = r.lines();
                let mut last_mcp: Option<String> = None;
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() { continue; }
                    if let Ok(j) = serde_json::from_str::<serde_json::Value>(&line) {
                        match j["type"].as_str().unwrap_or("") {
                            "stream_event" if j["event"]["type"].as_str() == Some("content_block_delta") => {
                                if let Some(t) = j["event"]["delta"]["text"].as_str() {
                                    let _ = app_c.emit("agent-output", AgentOutput { task_id: tid.clone(), line: t.into(), done: false });
                                }
                            }
                            "tool_use" => { last_mcp = j["tool_name"].as_str().or(j["name"].as_str()).and_then(|n| mcp_server_from_tool(n)); }
                            "tool_result" => {
                                if let Some(ref s) = last_mcp {
                                    let ie = j["is_error"].as_bool().unwrap_or(false);
                                    let ct = j["content"].as_str().or(j["error"].as_str()).unwrap_or("");
                                    if ie && is_mcp_connection_error(ct) {
                                        let (c, cr) = record_mcp_failure(&tid, s);
                                        let _ = app_c.emit("mcp-failure", McpFailureEvent { task_id: tid.clone(), server_name: s.clone(), error_message: ct.chars().take(200).collect(), failure_count: c, is_critical: cr });
                                    } else if !ie { reset_mcp_failure(&tid, s); }
                                }
                                last_mcp = None;
                            }
                            "result" => { if let Some(sid) = j["session_id"].as_str() { SESSION_REGISTRY.lock().unwrap().insert(tid.clone(), sid.into()); } }
                            _ => {}
                        }
                    }
                }
            });
            let app_c2 = app.clone(); let tid2 = task_id.clone();
            let eh = tokio::spawn(async move {
                let r = BufReader::new(stderr); let mut lines = r.lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    let _ = app_c2.emit("agent-output", AgentOutput { task_id: tid2.clone(), line: format!("[stderr] {}", l), done: false });
                }
            });
            let _ = sh.await; let _ = eh.await;
            let maybe_child = { AGENT_REGISTRY.lock().unwrap().remove(&task_id) };
            if let Some(mut c) = maybe_child { let _ = c.wait().await; }
            let _ = app.emit("agent-output", AgentOutput { task_id: task_id.clone(), line: String::new(), done: true });
            Ok("resumed".into())
        }

        "fallback" | _ => {
            let instructions = mcp_fallback_instructions(&server_name);
            let mut cmd = tokio::process::Command::new("/Users/ajholloway/.local/bin/claude");
            cmd.current_dir("/Users/ajholloway/Programming");
            cmd.env("CLAUDE_CODE_ENABLE_TELEMETRY", "0");
            cmd.env("OTEL_METRICS_EXPORTER", "");
            cmd.env("OTEL_LOGS_EXPORTER", "");
            cmd.env("OTEL_EXPORTER_OTLP_ENDPOINT", "");
            inject_all_api_keys(&mut cmd);
            cmd.arg("--print").arg("--output-format").arg("stream-json");
            cmd.arg("--verbose").arg("--include-partial-messages");
            cmd.arg("--settings").arg(r#"{"otelHeadersHelper":""}"#);
            cmd.arg("--mcp-config").arg(r#"{"mcpServers":{}}"#);
            cmd.arg("--strict-mcp-config");
            cmd.arg("--resume").arg(&session_id);
            cmd.arg("--dangerously-skip-permissions");
            cmd.arg(&instructions);
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

            let mut child = cmd.spawn().map_err(|e| format!("Fallback failed: {}", e))?;
            let stdout = child.stdout.take().ok_or("No stdout")?;
            let stderr = child.stderr.take().ok_or("No stderr")?;
            AGENT_REGISTRY.lock().unwrap().insert(task_id.clone(), child);

            let app_c = app.clone(); let tid = task_id.clone();
            let sh = tokio::spawn(async move {
                let r = BufReader::new(stdout); let mut lines = r.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() { continue; }
                    if let Ok(j) = serde_json::from_str::<serde_json::Value>(&line) {
                        if j["type"].as_str() == Some("stream_event") && j["event"]["type"].as_str() == Some("content_block_delta") {
                            if let Some(t) = j["event"]["delta"]["text"].as_str() {
                                let _ = app_c.emit("agent-output", AgentOutput { task_id: tid.clone(), line: t.into(), done: false });
                            }
                        }
                        if j["type"].as_str() == Some("result") { if let Some(sid) = j["session_id"].as_str() { SESSION_REGISTRY.lock().unwrap().insert(tid.clone(), sid.into()); } }
                    }
                }
            });
            let app_c2 = app.clone(); let tid2 = task_id.clone();
            let eh = tokio::spawn(async move {
                let r = BufReader::new(stderr); let mut lines = r.lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    let _ = app_c2.emit("agent-output", AgentOutput { task_id: tid2.clone(), line: format!("[stderr] {}", l), done: false });
                }
            });
            let _ = sh.await; let _ = eh.await;
            let maybe_child = { AGENT_REGISTRY.lock().unwrap().remove(&task_id) };
            if let Some(mut c) = maybe_child { let _ = c.wait().await; }
            let _ = app.emit("agent-output", AgentOutput { task_id: task_id.clone(), line: String::new(), done: true });
            Ok("fallback".into())
        }
    }
}

