//! Lets AI apps such as Claude Desktop read what you're reading and the words you saved.
//!
//! `siyaq --mcp` runs a small MCP server over stdin/stdout instead of opening the window.
//! The running app writes a snapshot (`state.json`) whenever the page or the saved words
//! change, but only after the user turns this on in Settings. Words an AI app saves go to
//! `inbox.json`, which the app picks up and adds to My words.

use std::io::{BufRead, Write};
use std::path::PathBuf;

use serde_json::{json, Value};

/// Same folder as Tauri's app_data_dir, found without starting Tauri.
fn data_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("app.siyaq.reader").join("mcp")
}

fn state_path() -> PathBuf {
    data_dir().join("state.json")
}

fn inbox_path() -> PathBuf {
    data_dir().join("inbox.json")
}

fn write_json(path: &PathBuf, value: &Value) -> Result<(), String> {
    std::fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value).unwrap()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn read_json(path: &PathBuf) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

// ---------- Commands the app calls ----------

/// Saves what AI apps may see; `None` (sharing turned off) deletes it.
#[tauri::command]
pub fn mcp_share(state: Option<Value>) -> Result<(), String> {
    match state {
        Some(s) => write_json(&state_path(), &s),
        None => {
            let _ = std::fs::remove_file(state_path());
            let _ = std::fs::remove_file(inbox_path());
            Ok(())
        }
    }
}

/// Words AI apps saved since the last call.
#[tauri::command]
pub fn mcp_take_inbox() -> Vec<Value> {
    let words = read_json(&inbox_path()).and_then(|v| v.as_array().cloned()).unwrap_or_default();
    if !words.is_empty() {
        let _ = std::fs::remove_file(inbox_path());
    }
    words
}

/// The command an AI app runs to reach Siyaq, as an `mcpServers` entry.
fn server_entry() -> Result<Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(json!({ "command": exe.display().to_string(), "args": ["--mcp"] }))
}

#[tauri::command]
pub fn mcp_config() -> Result<String, String> {
    Ok(serde_json::to_string_pretty(&json!({ "mcpServers": { "siyaq": server_entry()? } })).unwrap())
}

/// Adds Siyaq to Claude Desktop's config, keeping everything else in it (and a backup).
#[tauri::command]
pub fn mcp_add_to_claude() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.display().to_string();
    // Run from the disk image or a quarantined copy, the path stops working once it's closed.
    if exe.starts_with("/Volumes/") || exe.contains("AppTranslocation") {
        return Err("not-installed".into());
    }
    let dir = dirs::config_dir().ok_or("no config folder")?.join("Claude");
    let path = dir.join("claude_desktop_config.json");
    let mut config = match std::fs::read(&path) {
        Ok(bytes) => {
            let _ = std::fs::write(dir.join("claude_desktop_config.json.bak"), &bytes);
            serde_json::from_slice(&bytes).map_err(|_| "Claude's config file isn't valid JSON, so it was left as it is".to_string())?
        }
        Err(_) => json!({}),
    };
    let obj = config.as_object_mut().ok_or("unexpected config format")?;
    let servers = obj.entry("mcpServers").or_insert_with(|| json!({}));
    servers.as_object_mut().ok_or("unexpected config format")?.insert("siyaq".into(), server_entry()?);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(&path, serde_json::to_vec_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

// ---------- The server ----------

fn tools() -> Value {
    json!([
        {
            "name": "get_current_reading",
            "description": "The book open in Siyaq right now: its title, the page the reader is on, and the text of that page and the next two. Use it to explain, summarise or quiz the reader on what they are reading.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "get_saved_words",
            "description": "Words the reader looked up in Siyaq, newest first, each with its translation, why it means that, the sentence it came from, the book, the date, and spaced-repetition progress (box 0-5; due = time it should be reviewed). Translations are in the reader's chosen language.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "book": { "type": "string", "description": "Only words from books whose title contains this" },
                    "days": { "type": "integer", "description": "Only words saved in the last N days" },
                    "due_only": { "type": "boolean", "description": "Only words due for review now" },
                    "limit": { "type": "integer", "description": "At most this many (default 50)" }
                }
            }
        },
        {
            "name": "save_word",
            "description": "Adds a word or phrase to the reader's My words in Siyaq, so it appears in their flashcards. Give the translation in the reader's language (see get_saved_words for examples).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "word": { "type": "string" },
                    "translation": { "type": "string" },
                    "explanation": { "type": "string", "description": "A short note on the meaning" },
                    "sentence": { "type": "string", "description": "An example sentence, ideally from the book" }
                },
                "required": ["word", "translation"]
            }
        }
    ])
}

const NOT_SHARED: &str = "Siyaq isn't sharing anything yet. Open Siyaq, go to Settings and turn on \"Connect to AI apps\".";

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn call_tool(name: &str, args: &Value) -> Result<String, String> {
    let state = read_json(&state_path());
    match name {
        "get_current_reading" => {
            let state = state.ok_or(NOT_SHARED)?;
            match state.get("book") {
                Some(b) if !b.is_null() => Ok(serde_json::to_string_pretty(b).unwrap()),
                _ => Ok("No book is open in Siyaq right now.".into()),
            }
        }
        "get_saved_words" => {
            let state = state.ok_or(NOT_SHARED)?;
            let book = args.get("book").and_then(Value::as_str).map(str::to_lowercase);
            let since = args.get("days").and_then(Value::as_i64).map(|d| now_ms() - d * 86_400_000);
            let due_only = args.get("due_only").and_then(Value::as_bool).unwrap_or(false);
            let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
            let words: Vec<&Value> = state["words"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
            let picked: Vec<&Value> = words
                .into_iter()
                .filter(|w| book.as_ref().map_or(true, |b| w["book"].as_str().unwrap_or("").to_lowercase().contains(b)))
                .filter(|w| since.map_or(true, |s| w["saved"].as_i64().unwrap_or(0) >= s))
                .filter(|w| !due_only || w["due"].as_i64().unwrap_or(0) <= now_ms())
                .take(limit)
                .collect();
            Ok(json!({ "translation_language": state["lang"], "count": picked.len(), "words": picked }).to_string())
        }
        "save_word" => {
            let word = args.get("word").and_then(Value::as_str).map(str::trim).filter(|w| !w.is_empty()).ok_or("word is required")?;
            let translation = args.get("translation").and_then(Value::as_str).ok_or("translation is required")?;
            state.ok_or(NOT_SHARED)?;
            let mut inbox = read_json(&inbox_path()).and_then(|v| v.as_array().cloned()).unwrap_or_default();
            inbox.push(json!({
                "word": word,
                "translation": translation,
                "explanation": args.get("explanation").and_then(Value::as_str).unwrap_or(""),
                "sentence": args.get("sentence").and_then(Value::as_str).unwrap_or(""),
            }));
            write_json(&inbox_path(), &Value::Array(inbox))?;
            Ok(format!("Saved \"{word}\". It appears in My words the next time Siyaq is open."))
        }
        _ => Err(format!("unknown tool: {name}")),
    }
}

fn handle(msg: &Value) -> Option<Value> {
    let id = msg.get("id")?.clone(); // notifications get no reply
    let method = msg["method"].as_str().unwrap_or("");
    let result = match method {
        "initialize" => json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "siyaq", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Siyaq is the user's book reader. It knows the page they're reading and the words they looked up, with translations in their language."
        }),
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or("");
            let args = msg["params"].get("arguments").cloned().unwrap_or(json!({}));
            match call_tool(name, &args) {
                Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
                Err(text) => json!({ "content": [{ "type": "text", "text": text }], "isError": true }),
            }
        }
        _ => return Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("unknown method: {method}") } })),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

pub fn serve() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => handle(&msg),
            Err(_) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "parse error" } })),
        };
        if let Some(reply) = reply {
            let _ = writeln!(out, "{reply}");
            let _ = out.flush();
        }
    }
}
