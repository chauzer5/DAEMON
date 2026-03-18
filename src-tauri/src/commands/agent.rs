use std::collections::HashMap;
use std::io::Read;
use std::process::Stdio;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use regex::Regex;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};

// Global PTY registry — maps pty_id to (master, child)
static PTY_REGISTRY: Lazy<Mutex<HashMap<String, PtyHandle>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// Global agent process registry — maps task_id to child process handle
static AGENT_REGISTRY: Lazy<Mutex<HashMap<String, tokio::process::Child>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// PID registry for std::process children (used by run_interactive_agent)
static PID_REGISTRY: Lazy<Mutex<HashMap<String, u32>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// Writer registry for interactive agents — maps pty_id to a reusable writer
static PTY_WRITER_REGISTRY: Lazy<Mutex<HashMap<String, Box<dyn std::io::Write + Send>>>> =
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
    cmd.arg("--print");

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

    // Stream stdout with question detection
    // Agents are instructed to use "### Question for User" sections in their output
    // when they need user input. We detect this pattern and emit agent-question events.
    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut question_block: Option<Vec<String>> = None;

        while let Ok(Some(line)) = lines.next_line().await {
            // Detect question block start: "### Question for User" or "### Question"
            if line.starts_with("### Question for User")
                || line.starts_with("### Question")
                || line.starts_with("## Question for User")
            {
                question_block = Some(Vec::new());
            }
            // Detect question block end: next heading or empty after content
            else if question_block.is_some()
                && (line.starts_with("### ") || line.starts_with("## "))
            {
                // New section started — emit the collected question
                if let Some(block) = question_block.take() {
                    let question_text = block
                        .into_iter()
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
            }
            // Accumulate question body lines
            else if let Some(ref mut block) = question_block {
                block.push(line.clone());
            }

            // Always emit the line as output too
            let _ = app_clone.emit(
                "agent-output",
                AgentOutput {
                    task_id: tid.clone(),
                    line,
                    done: false,
                },
            );
        }

        // If stream ends while in a question block, emit what we have
        if let Some(block) = question_block.take() {
            let question_text = block
                .into_iter()
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

/// Respond to an interactive agent by writing to its stdin.
/// For stream-json agents, sends a JSON user message.
/// Also accepts task_id/question_id so the frontend store can track the answer.
#[tauri::command]
pub async fn respond_to_agent(
    task_id: String,
    _question_id: Option<String>,
    response: String,
) -> Result<(), String> {
    use std::io::Write;
    let mut registry = PTY_WRITER_REGISTRY.lock().unwrap();
    if let Some(writer) = registry.get_mut(&task_id) {
        // Send as stream-json formatted user message
        let json_msg = serde_json::json!({
            "type": "user",
            "content": response
        });
        let mut message = serde_json::to_string(&json_msg).map_err(|e| e.to_string())?;
        message.push('\n');
        writer
            .write_all(message.as_bytes())
            .map_err(|e| format!("Failed to write to stdin: {}", e))?;
        writer.flush().map_err(|e| format!("Failed to flush stdin: {}", e))?;
        Ok(())
    } else {
        Ok(())
    }
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

    // Disable otelHeadersHelper and use no MCP servers
    cmd.arg("--settings").arg(r#"{"otelHeadersHelper":""}"#);
    cmd.arg("--mcp-config").arg(r#"{"mcpServers":{}}"#);
    cmd.arg("--strict-mcp-config");

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

    // Stream stdout — parse stream-json events for text deltas
    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

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
                    "assistant" => {
                        // Full message — already streamed via deltas
                    }
                    "result" => {
                        // Completion
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

