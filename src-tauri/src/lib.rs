use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{ipc::Response, Emitter, Manager};

pub mod mcp;

/// A book the OS asked us to open before the page was ready to receive it.
#[derive(Default)]
struct PendingFile(Mutex<Option<PathBuf>>);

#[derive(serde::Serialize)]
struct AiResponse {
    status: u16,
    body: serde_json::Value,
}

/// One client for every AI call, so the connection (and its TLS handshake) is reused from one lookup to the next.
/// A server that doesn't connect in 8 s, or goes 20 s without sending anything, fails, and the app moves on to
/// another model instead of waiting. Idle connections are let go after 30 s, before servers drop them unseen.
fn client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(8))
            .read_timeout(std::time::Duration::from_secs(20))
            .pool_idle_timeout(std::time::Duration::from_secs(30))
            .tcp_keepalive(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default()
    })
}

/// Sends a request; if a kept connection turns out to be closed already (nothing was answered), once more on a
/// fresh one, instead of failing the lookup and falling back to a slower way.
async fn send(req: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    let again = req.try_clone();
    match req.send().await {
        Err(e) if (e.is_connect() || e.is_request()) && again.is_some() => again.unwrap().send().await.map_err(|e| e.to_string()),
        r => r.map_err(|e| e.to_string()),
    }
}

/// Sends the lookup request from the app itself, so AI servers don't need to
/// allow browser (CORS) requests. That is what makes local Ollama just work.
#[tauri::command]
async fn ai_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<serde_json::Value>,
) -> Result<AiResponse, String> {
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client().request(method, &url);
    if let Some(body) = body {
        req = req.json(&body);
    }
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let res = send(req).await?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let body = serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text));
    Ok(AiResponse { status, body })
}

/// Like ai_request, but hands the reply over piece by piece as it arrives (server-sent events), so the
/// meaning can show while the rest is still being written. Returns the status; an error reply is returned whole.
#[tauri::command]
async fn ai_stream(
    url: String,
    headers: HashMap<String, String>,
    body: serde_json::Value,
    on_chunk: tauri::ipc::Channel<String>,
) -> Result<u16, String> {
    use futures_util::StreamExt;
    let mut req = client().post(&url).json(&body);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let res = send(req).await?;
    let status = res.status().as_u16();
    if !res.status().is_success() {
        return Err(res.text().await.unwrap_or_default());
    }
    // Pieces can end in the middle of a character: hold back an unfinished one until the rest arrives.
    let mut stream = res.bytes_stream();
    let mut pending: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        pending.extend_from_slice(&chunk.map_err(|e| e.to_string())?);
        let valid = match std::str::from_utf8(&pending) {
            Ok(_) => pending.len(),
            Err(e) => e.valid_up_to(),
        };
        if valid > 0 {
            let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
            pending.drain(..valid);
            on_chunk.send(text).map_err(|e| e.to_string())?;
        }
    }
    // A last, empty-but-for-NUL message says the reply is complete (channel messages arrive in order).
    on_chunk.send("\0".into()).map_err(|e| e.to_string())?;
    Ok(status)
}

/// Opens a web page in the user's browser (used for getting an API key).
#[tauri::command]
fn open_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    // Web pages, and an email to the project's own address (for feedback).
    if !url.starts_with("https://") && !url.starts_with("mailto:contact@x13labs.com") {
        return Err("only https links can be opened".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// The newer version on GitHub Releases, if there is one.
#[cfg(desktop)]
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| u.version))
}

/// Downloads the signed update, installs it and restarts, telling the page how far it has got:
/// {"stage":"download","done":bytes,"total":bytes} as it downloads (total 0 when the server doesn't say),
/// then {"stage":"install"}, then {"stage":"restart"}.
#[cfg(desktop)]
#[tauri::command]
async fn install_update(app: tauri::AppHandle, on_progress: tauri::ipc::Channel<serde_json::Value>) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        let mut done: u64 = 0;
        let mut sent = std::time::Instant::now() - std::time::Duration::from_secs(1);
        let progress = on_progress.clone();
        let bytes = update
            .download(
                move |chunk, total| {
                    done += chunk as u64;
                    // a few times a second is plenty for a progress bar
                    if sent.elapsed().as_millis() >= 120 || total.is_some_and(|t| done >= t) {
                        sent = std::time::Instant::now();
                        let _ = progress.send(serde_json::json!({ "stage": "download", "done": done, "total": total.unwrap_or(0) }));
                    }
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        let _ = on_progress.send(serde_json::json!({ "stage": "install" }));
        update.install(bytes).map_err(|e| e.to_string())?;
        let _ = on_progress.send(serde_json::json!({ "stage": "restart" }));
        std::thread::sleep(std::time::Duration::from_millis(900)); // a moment to read "reopening"
        app.restart();
    }
    Ok(())
}

/// Asks for a file with the system's own picker, so the app knows where it is (for Recent books).
#[cfg(desktop)]
#[tauri::command]
async fn pick_file(app: tauri::AppHandle, label: String, extensions: Vec<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    app.dialog()
        .file()
        .add_filter(label, &exts)
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.display().to_string())
}

/// Saves text to a file the user chooses (backups, the Anki export): where it went, or None if cancelled.
#[cfg(desktop)]
#[tauri::command]
async fn save_file(app: tauri::AppHandle, name: String, contents: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(path) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// Saves a file of any kind (a book with your marks, images, a Word file): its bytes come as the request's body,
/// as they are, and its name in a header (percent-encoded, so Arabic and Turkish names arrive whole).
#[cfg(desktop)]
#[tauri::command]
async fn save_bytes(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_else(|| "siyaq".into());
    let Some(path) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

#[cfg(any(desktop, target_os = "android"))]
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------- Android ----------
// Books are opened with the system's file picker (or "Open with" / "Share" from another app); each is copied into
// the app's own folder, so it can be opened again from Recent books after a restart. Saving goes through the
// system's "save to" screen. Both are done by the app's own Android code (SiyaqPlugin.kt).
#[cfg(target_os = "android")]
mod android {
    use serde::de::DeserializeOwned;
    use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Manager, Runtime, Wry};

    pub struct Native<R: Runtime>(PluginHandle<R>);

    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("siyaq")
            .setup(|app, api| {
                app.manage(Native(api.register_android_plugin("app.siyaq.reader", "SiyaqPlugin")?));
                Ok(())
            })
            .build()
    }

    pub async fn call<T: DeserializeOwned>(app: &tauri::AppHandle, command: &str, args: serde_json::Value) -> Result<T, String> {
        app.state::<Native<Wry>>().0.run_mobile_plugin_async(command, args).await.map_err(|e| e.to_string())
    }

    #[derive(serde::Deserialize)]
    pub struct Picked {
        pub path: Option<String>,
        #[serde(default)]
        pub text: Option<String>,
    }
    #[derive(serde::Deserialize)]
    pub struct Saved {
        pub saved: bool,
    }

    fn mime(ext: &str) -> &'static str {
        match ext {
            "pdf" => "application/pdf",
            "epub" => "application/epub+zip",
            "json" => "application/json",
            "png" => "image/png",
            "zip" => "application/zip",
            "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "md" => "text/markdown",
            "txt" => "text/plain",
            "csv" | "tsv" => "text/plain",
            _ => "application/octet-stream",
        }
    }

    pub async fn pick(app: &tauri::AppHandle, extensions: &[String]) -> Option<String> {
        // Some file apps call an EPUB (or a backup) just "a file": those are let through, and checked when opened.
        let mut types: Vec<&str> = extensions.iter().map(|e| mime(e)).collect();
        types.push("application/octet-stream");
        let books = extensions.iter().any(|e| e == "pdf" || e == "epub");
        let r: Picked = call(app, "pickFile", serde_json::json!({ "mimeTypes": types, "folder": if books { "books" } else { "picked" } })).await.ok()?;
        r.path
    }

    pub async fn save(app: &tauri::AppHandle, name: &str, bytes: &[u8]) -> Result<Option<String>, String> {
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("out");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let source = dir.join(format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)));
        std::fs::write(&source, bytes).map_err(|e| e.to_string())?;
        let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
        let r: Result<Saved, String> = call(app, "saveFile", serde_json::json!({ "source": source.display().to_string(), "name": name, "mime": mime(&ext) })).await;
        let _ = std::fs::remove_file(&source);
        Ok(r?.saved.then(|| name.to_string()))
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn pick_file(app: tauri::AppHandle, label: String, extensions: Vec<String>) -> Option<String> {
    let _ = label;
    android::pick(&app, &extensions).await
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn save_file(app: tauri::AppHandle, name: String, contents: String) -> Result<Option<String>, String> {
    android::save(&app, &name, contents.as_bytes()).await
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn save_bytes(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_else(|| "siyaq".into());
    android::save(&app, &name, bytes).await
}

/// Android's bridge carries text only, so a file to save (Save as) comes as base64.
#[cfg(target_os = "android")]
#[tauri::command]
async fn save_base64(app: tauri::AppHandle, name: String, data: String) -> Result<Option<String>, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    android::save(&app, &name, &bytes).await
}
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn save_base64() -> Result<Option<String>, String> {
    Err("Android only".into())
}

/// The sizes of the status bar, navigation bar and keyboard (CSS pixels), with the bars' icons set for a light or
/// dark page.
#[cfg(target_os = "android")]
#[tauri::command]
async fn android_bars(app: tauri::AppHandle, dark: bool) -> Result<serde_json::Value, String> {
    android::call(&app, "bars", serde_json::json!({ "dark": dark })).await
}
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn android_bars() -> Result<serde_json::Value, String> {
    Ok(serde_json::Value::Null)
}

/// On Android a new version is an APK on GitHub Releases: the newer version, if there is one...
#[cfg(target_os = "android")]
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let r = send(client().get("https://github.com/SaadHASSON1/siyaq/releases/latest/download/latest.json")).await?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status().as_u16()));
    }
    let v: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
    let latest = v["version"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    let parts = |s: &str| s.split('.').map(|n| n.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    Ok((parts(&latest) > parts(&app.package_info().version.to_string())).then_some(latest))
}

/// ...and it is downloaded by the browser, which hands it to Android's installer (the system asks first).
#[cfg(target_os = "android")]
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://github.com/SaadHASSON1/siyaq/releases/latest/download/Siyaq-Android.apk", None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "ios")]
#[tauri::command]
async fn check_update() -> Result<Option<String>, String> {
    Ok(None)
}
#[cfg(target_os = "ios")]
#[tauri::command]
async fn install_update() -> Result<(), String> {
    Ok(())
}
#[cfg(target_os = "ios")]
#[tauri::command]
async fn pick_file() -> Option<String> {
    None
}
#[cfg(target_os = "ios")]
#[tauri::command]
async fn save_file() -> Result<Option<String>, String> {
    Ok(None)
}
#[cfg(target_os = "ios")]
#[tauri::command]
async fn save_bytes() -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
fn read_book(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
async fn take_pending_file(app: tauri::AppHandle) -> Option<String> {
    #[cfg(target_os = "android")]
    if let Ok(picked) = android::call::<android::Picked>(&app, "takeOpened", serde_json::json!({})).await {
        if let Some(text) = picked.text {
            *app.state::<SharedText>().0.lock().unwrap() = Some(text);
        }
        if let Some(p) = picked.path {
            return Some(p);
        }
    }
    app.state::<PendingFile>().0.lock().unwrap().take().map(|p| p.display().to_string())
}

/// Words another app sent with "Siyaq" from its text-selection menu (Android), once.
#[derive(Default)]
struct SharedText(Mutex<Option<String>>);
#[tauri::command]
fn take_shared_text(state: tauri::State<SharedText>) -> Option<String> {
    state.0.lock().unwrap().take()
}

fn open_file(app: &tauri::AppHandle, path: PathBuf) {
    *app.state::<PendingFile>().0.lock().unwrap() = Some(path.clone());
    let _ = app.emit("open-file", path.display().to_string());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PendingFile::default())
        .manage(SharedText::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ai_request,
            ai_stream,
            read_book,
            take_pending_file,
            take_shared_text,
            android_bars,
            save_base64,
            open_link,
            check_update,
            install_update,
            pick_file,
            save_file,
            save_bytes,
            mcp::mcp_share,
            mcp::mcp_share_book,
            mcp::mcp_take_inbox,
            mcp::mcp_config,
            mcp::mcp_add_to_claude
        ])
        .setup(|app| {
            #[cfg(target_os = "android")]
            app.handle().plugin(android::init())?;
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_dialog::init())?;
            }

            // Windows and Linux pass the double-clicked file as an argument.
            if let Some(arg) = std::env::args().skip(1).find(|a| {
                let a = a.to_lowercase();
                a.ends_with(".pdf") || a.ends_with(".epub")
            }) {
                open_file(app.handle(), PathBuf::from(arg));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Siyaq")
        .run(|_app, _event| {
            // macOS sends double-clicked files as an event instead.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = _event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        open_file(_app, path);
                    }
                }
            }
        });
}
