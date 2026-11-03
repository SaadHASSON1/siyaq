// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by an AI app (Claude Desktop and others) to talk to Siyaq; no window.
    if std::env::args().any(|a| a == "--mcp") {
        return siyaq_lib::mcp::serve();
    }
    siyaq_lib::run()
}
