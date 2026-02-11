use crate::model::{self, DownloadProgress, WhisperModel};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

static DOWNLOAD_PROGRESS: OnceLock<Mutex<HashMap<String, Arc<Mutex<DownloadProgress>>>>> =
    OnceLock::new();

fn get_progress_map() -> &'static Mutex<HashMap<String, Arc<Mutex<DownloadProgress>>>> {
    DOWNLOAD_PROGRESS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub fn list_models(app_handle: tauri::AppHandle) -> Vec<WhisperModel> {
    let models_dir = model::get_models_dir(&app_handle);
    model::list_downloaded_models(&models_dir)
}

#[tauri::command]
pub async fn download_model(
    app_handle: tauri::AppHandle,
    model_id: String,
) -> Result<(), String> {
    let models = model::get_available_models();
    let model_info = models
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("Model bulunamadi: {}", model_id))?
        .clone();

    let models_dir = model::get_models_dir(&app_handle);
    let dest = models_dir.join(&model_info.filename);

    let progress = Arc::new(Mutex::new(DownloadProgress {
        model_id: model_id.clone(),
        ..Default::default()
    }));

    {
        let mut map = get_progress_map().lock();
        map.insert(model_id.clone(), progress.clone());
    }

    model::download_model_file(&model_info.url, &dest, progress).await?;

    Ok(())
}

#[tauri::command]
pub fn get_download_progress(model_id: String) -> Option<DownloadProgress> {
    let map = get_progress_map().lock();
    map.get(&model_id).map(|p| p.lock().clone())
}

#[tauri::command]
pub fn delete_model(app_handle: tauri::AppHandle, model_id: String) -> Result<(), String> {
    let models_dir = model::get_models_dir(&app_handle);
    let model_path = model::get_model_path(&models_dir, &model_id)
        .ok_or_else(|| format!("Model bulunamadi: {}", model_id))?;

    if model_path.exists() {
        std::fs::remove_file(&model_path)
            .map_err(|e| format!("Model silinemedi: {}", e))?;
    }

    Ok(())
}
