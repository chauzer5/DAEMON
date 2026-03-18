use std::collections::HashMap;
use std::io::Read;
use std::process::Stdio;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};

// Global PTY registry — maps pty_id to (master, child)
static PTY_REGISTRY: Lazy<Mutex<HashMap<String, PtyHandle>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// Global agent process registry — maps task_id to child process handle
static AGENT_REGISTRY: Lazy<Mutex<HashMap<String, tokio::process::Child>>> = Lazy::new(|| Mutex::new(HashMap::new()));

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

/// Respond to a pending agent question. The response is stored so a future
/// interactive agent (PTY-based) can consume it. For now we emit an event so
/// Respond to an interactive agent's question by writing to its PTY stdin.
/// Also accepts task_id/question_id so the frontend store can track the answer.
#[tauri::command]
pub async fn respond_to_agent(
    task_id: String,
    _question_id: Option<String>,
    response: String,
) -> Result<(), String> {
    use std::io::Write;
    // Try writing to the PTY writer for this task
    let mut registry = PTY_WRITER_REGISTRY.lock().unwrap();
    if let Some(writer) = registry.get_mut(&task_id) {
        let mut message = response;
        message.push('\n');
        writer
            .write_all(message.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        writer.flush().map_err(|e| format!("Failed to flush PTY: {}", e))?;
        Ok(())
    } else {
        // Agent might not be PTY-based or already finished
        Ok(())
    }
}

/// Kill a running agent command process.
#[tauri::command]
pub async fn kill_agent_command(task_id: String) -> Result<(), String> {
    let child = {
        let mut registry = AGENT_REGISTRY.lock().unwrap();
        registry.remove(&task_id)
    };
    if let Some(mut child) = child {
        let _ = child.start_kill();
        let _ = child.wait().await; // reap the process
        Ok(())
    } else {
        Ok(())
    }
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
    let mut registry = PTY_REGISTRY.lock().unwrap();
    if let Some(mut handle) = registry.remove(&pty_id) {
        let _ = handle.child.kill();
        Ok(())
    } else {
        Err(format!("PTY {} not found", pty_id))
    }
}

/// Spawn Claude CLI in an interactive PTY session that supports the SendUserMessage tool.
/// Uses `--brief` to enable the agent to ask the user questions via stdin.
/// Emits `agent-output` for all output and `agent-question` when the agent asks a question.
/// Returns immediately — use `respond_to_agent` to send replies.
#[tauri::command]
pub async fn run_interactive_agent(
    app: tauri::AppHandle,
    task_id: String,
    command: String,
    args: String,
    options: Option<AgentOptions>,
) -> Result<(), String> {
    let opts = options.unwrap_or_default();

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

    // Use --brief to enable the SendUserMessage tool (interactive question support)
    cmd.arg("--brief");

    // Model selection
    let effective_model = opts.model.as_deref();
    if let Some(m) = effective_model {
        let model_id = match m {
            "opus" => "claude-opus-4-6",
            "haiku" => "claude-haiku-4-5-20251001",
            _ => "claude-sonnet-4-6",
        };
        cmd.arg("--model");
        cmd.arg(model_id);
    }

    // System prompt
    if let Some(ref sp) = opts.system_prompt {
        cmd.arg("--system-prompt");
        cmd.arg(sp);
    }

    // Allowed tools
    if let Some(ref tools) = opts.allowed_tools {
        if !tools.is_empty() {
            cmd.arg("--allowedTools");
            for tool in tools {
                cmd.arg(tool);
            }
        }
    }

    // Denied tools
    if let Some(ref tools) = opts.denied_tools {
        if !tools.is_empty() {
            cmd.arg("--disallowedTools");
            for tool in tools {
                cmd.arg(tool);
            }
        }
    }

    // Budget cap
    if let Some(budget) = opts.max_budget_usd {
        cmd.arg("--max-budget-usd");
        cmd.arg(budget.to_string());
    }

    // Disable slash commands
    if opts.disable_slash_commands.unwrap_or(false) {
        cmd.arg("--disable-slash-commands");
    }

    cmd.arg(&prompt);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn in PTY: {}", e))?;

    // Claim the writer up front so respond_to_agent can reuse it
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    // Get a reader from the master side
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    // Store the PTY handle and its writer
    {
        let mut pty_reg = PTY_REGISTRY.lock().unwrap();
        pty_reg.insert(
            task_id.clone(),
            PtyHandle {
                master: pair.master,
                child,
            },
        );
    }
    {
        let mut writer_reg = PTY_WRITER_REGISTRY.lock().unwrap();
        writer_reg.insert(task_id.clone(), writer);
    }

    // Stream PTY output in a background thread, scanning for question patterns
    let app_clone = app.clone();
    let tid = task_id.clone();
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        // Accumulator for partial lines — used for question detection
        let mut line_buf = String::new();
        // Multi-line accumulator for detecting the full question block
        let mut question_accumulator = String::new();
        let mut in_question_block = false;

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();

                    // Emit raw output
                    let _ = app_clone.emit(
                        "agent-output",
                        AgentOutput {
                            task_id: tid.clone(),
                            line: text.clone(),
                            done: false,
                        },
                    );

                    // Question detection — scan each character for newlines
                    for ch in text.chars() {
                        if ch == '\n' || ch == '\r' {
                            let trimmed = line_buf.trim().to_string();

                            if !trimmed.is_empty() {
                                // Detect start of a question block
                                if trimmed.contains("wants to send you a message")
                                    || trimmed.contains("SendUserMessage")
                                {
                                    in_question_block = true;
                                    question_accumulator.clear();
                                }

                                if in_question_block {
                                    // Detect the prompt line that ends the block
                                    if trimmed.contains("Type your response")
                                        || trimmed.contains("press Enter to skip")
                                    {
                                        // question_accumulator holds the message body
                                        let question = question_accumulator.trim().to_string();
                                        if !question.is_empty() {
                                            let _ = app_clone.emit(
                                                "agent-question",
                                                AgentQuestion {
                                                    task_id: tid.clone(),
                                                    question,
                                                },
                                            );
                                        }
                                        in_question_block = false;
                                        question_accumulator.clear();
                                    } else if !trimmed.contains("wants to send you a message")
                                        && !trimmed.contains("SendUserMessage")
                                    {
                                        // Body line of the question
                                        if !question_accumulator.is_empty() {
                                            question_accumulator.push('\n');
                                        }
                                        question_accumulator.push_str(&trimmed);
                                    }
                                }
                            }

                            line_buf.clear();
                        } else {
                            line_buf.push(ch);
                        }
                    }
                }
                Err(_) => break,
            }
        }

        // Signal completion
        let _ = app_clone.emit(
            "agent-output",
            AgentOutput {
                task_id: tid.clone(),
                line: String::new(),
                done: true,
            },
        );

        // Cleanup both registries
        {
            let mut pty_reg = PTY_REGISTRY.lock().unwrap();
            pty_reg.remove(&tid);
        }
        {
            let mut writer_reg = PTY_WRITER_REGISTRY.lock().unwrap();
            writer_reg.remove(&tid);
        }
    });

    Ok(())
}

