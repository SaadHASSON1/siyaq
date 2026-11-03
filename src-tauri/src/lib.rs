use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{ipc::Response, Emitter, Manager};

/// A PDF the OS asked us to open before the page was ready to receive it.
#[derive(Default)]
struct PendingFile(Mutex<Option<PathBuf>>);

#[derive(serde::Serialize)]
struct AiResponse {
    status: u16,
    body: serde_json::Value,
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
    let mut req = reqwest::Client::new().request(method, &url);
    if let Some(body) = body {
        req = req.json(&body);
    }
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let body = serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text));
    Ok(AiResponse { status, body })
}

/// Opens a web page in the user's browser (used for getting an API key).
#[tauri::command]
fn open_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !url.starts_with("https://") {
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

/// Downloads the signed update, installs it and restarts.
#[cfg(desktop)]
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

// Phones and tablets update through their app stores.
#[cfg(mobile)]
#[tauri::command]
async fn check_update() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(mobile)]
#[tauri::command]
async fn install_update() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn read_pdf(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
fn take_pending_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().unwrap().take().map(|p| p.display().to_string())
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ai_request,
            read_pdf,
            take_pending_file,
            open_link,
            check_update,
            install_update
        ])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            // Windows and Linux pass the double-clicked file as an argument.
            if let Some(arg) = std::env::args().skip(1).find(|a| a.to_lowercase().ends_with(".pdf")) {
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
