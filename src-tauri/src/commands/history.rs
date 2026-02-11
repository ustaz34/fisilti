use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri_plugin_store::StoreExt;

const HISTORY_STORE_PATH: &str = "history.json";
const MAX_HISTORY_ENTRIES: usize = 500;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct HistoryEntry {
    pub id: String,
    pub text: String,
    pub timestamp: u64,
    pub duration_ms: u64,
    pub engine: String,
    pub language: String,
    pub model_id: String,
}

#[tauri::command]
pub fn save_history_entry(app_handle: tauri::AppHandle, entry: HistoryEntry) -> Result<(), String> {
    let store = app_handle.store(HISTORY_STORE_PATH)
        .map_err(|e| format!("History store acilamadi: {}", e))?;

    let mut entries: Vec<HistoryEntry> = store.get("entries")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    entries.insert(0, entry);

    // Maksimum giris sayisini asma
    if entries.len() > MAX_HISTORY_ENTRIES {
        entries.truncate(MAX_HISTORY_ENTRIES);
    }

    store.set("entries", serde_json::json!(entries));
    store.save().map_err(|e| format!("Gecmis kaydedilemedi: {}", e))?;

    // Tum pencerelere bildir (istatistik paneli canli guncellensin)
    app_handle.emit("history-updated", ()).ok();

    Ok(())
}

#[tauri::command]
pub fn get_history(app_handle: tauri::AppHandle) -> Vec<HistoryEntry> {
    let store = match app_handle.store(HISTORY_STORE_PATH) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    store.get("entries")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn clear_history(app_handle: tauri::AppHandle) -> Result<(), String> {
    let store = app_handle.store(HISTORY_STORE_PATH)
        .map_err(|e| format!("History store acilamadi: {}", e))?;

    let empty: Vec<HistoryEntry> = Vec::new();
    store.set("entries", serde_json::json!(empty));
    store.save().map_err(|e| format!("Gecmis temizlenemedi: {}", e))?;

    app_handle.emit("history-updated", ()).ok();

    Ok(())
}
