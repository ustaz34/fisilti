use futures_util::StreamExt;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WhisperModel {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub size_display: String,
    pub url: String,
    pub filename: String,
    pub description: String,
    pub downloaded: bool,
}

#[derive(Clone, Serialize, Default)]
pub struct DownloadProgress {
    pub model_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub speed_bps: u64,
    pub status: String,
}

pub fn get_available_models() -> Vec<WhisperModel> {
    vec![
        WhisperModel {
            id: "small".to_string(),
            name: "Small".to_string(),
            size_bytes: 488_000_000,
            size_display: "488 MB".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin".to_string(),
            filename: "ggml-small.bin".to_string(),
            description: "Hizli, iyi kalite. Test icin uygun.".to_string(),
            downloaded: false,
        },
        WhisperModel {
            id: "large-v3-turbo-q5".to_string(),
            name: "Large V3 Turbo Q5".to_string(),
            size_bytes: 574_000_000,
            size_display: "574 MB".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".to_string(),
            filename: "ggml-large-v3-turbo-q5_0.bin".to_string(),
            description: "Cok iyi kalite, hizli. 8GB RAM altina onerilen.".to_string(),
            downloaded: false,
        },
        WhisperModel {
            id: "large-v3-turbo".to_string(),
            name: "Large V3 Turbo".to_string(),
            size_bytes: 1_620_000_000,
            size_display: "1.62 GB".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin".to_string(),
            filename: "ggml-large-v3-turbo.bin".to_string(),
            description: "Mukemmel kalite. Varsayilan onerilen model.".to_string(),
            downloaded: false,
        },
        WhisperModel {
            id: "large-v3".to_string(),
            name: "Large V3".to_string(),
            size_bytes: 3_100_000_000,
            size_display: "3.1 GB".to_string(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin".to_string(),
            filename: "ggml-large-v3.bin".to_string(),
            description: "En iyi kalite, yavas. Maksimum dogruluk isteyenler icin.".to_string(),
            downloaded: false,
        },
    ]
}

pub fn get_models_dir(app_handle: &AppHandle) -> PathBuf {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    data_dir.join("models")
}

pub fn list_downloaded_models(models_dir: &PathBuf) -> Vec<WhisperModel> {
    let mut models = get_available_models();
    for model in &mut models {
        let model_path = models_dir.join(&model.filename);
        if model_path.exists() {
            // Dosya boyutunu kontrol et - beklenen boyutun %90'indan kucukse bozuk say
            let file_size = std::fs::metadata(&model_path)
                .map(|m| m.len())
                .unwrap_or(0);
            let min_size = (model.size_bytes as f64 * 0.9) as u64;
            model.downloaded = file_size >= min_size;
            if !model.downloaded && file_size > 0 {
                log::warn!(
                    "Model {} bozuk gorunuyor: {} / {} bayt",
                    model.id, file_size, model.size_bytes
                );
            }
        } else {
            model.downloaded = false;
        }
    }
    models
}

pub fn get_model_path(models_dir: &PathBuf, model_id: &str) -> Option<PathBuf> {
    let models = get_available_models();
    models
        .iter()
        .find(|m| m.id == model_id)
        .map(|m| models_dir.join(&m.filename))
}

pub async fn download_model_file(
    url: &str,
    dest: &PathBuf,
    progress: Arc<Mutex<DownloadProgress>>,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    // Mevcut dosya boyutunu kontrol et (devam ettirme icin)
    let existing_size = if dest.exists() {
        std::fs::metadata(dest)
            .map(|m| m.len())
            .unwrap_or(0)
    } else {
        0
    };

    let mut request = client.get(url);
    if existing_size > 0 {
        request = request.header("Range", format!("bytes={}-", existing_size));
        log::info!("Indirme devam ediyor: {} bayttan", existing_size);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Indirme baslatilamadi: {}", e))?;

    let status = response.status();
    if !status.is_success() && status.as_u16() != 206 {
        return Err(format!("Sunucu hatasi: {}", status));
    }

    let total_size = if status.as_u16() == 206 {
        // Parcali indirme
        response
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split('/').last())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
    } else {
        response.content_length().unwrap_or(0)
    };

    {
        let mut p = progress.lock();
        p.total_bytes = total_size;
        p.downloaded_bytes = existing_size;
        p.status = "indiriliyor".to_string();
    }

    // Hedef klasoru olustur
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let mut file = if existing_size > 0 {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(dest)
            .await
            .map_err(|e| format!("Dosya acilamadi: {}", e))?
    } else {
        tokio::fs::File::create(dest)
            .await
            .map_err(|e| format!("Dosya olusturulamadi: {}", e))?
    };

    let mut stream = response.bytes_stream();
    let mut downloaded = existing_size;
    let start_time = std::time::Instant::now();

    use tokio::io::AsyncWriteExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Indirme hatasi: {}", e))?;

        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Yazma hatasi: {}", e))?;

        downloaded += chunk.len() as u64;

        let elapsed = start_time.elapsed().as_secs_f64();
        let speed = if elapsed > 0.0 {
            ((downloaded - existing_size) as f64 / elapsed) as u64
        } else {
            0
        };

        let mut p = progress.lock();
        p.downloaded_bytes = downloaded;
        p.percent = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };
        p.speed_bps = speed;
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush hatasi: {}", e))?;

    // Indirme sonrasi dosya boyutunu dogrula
    let final_size = tokio::fs::metadata(dest)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    if total_size > 0 && final_size < (total_size as f64 * 0.9) as u64 {
        // Bozuk dosyayi sil
        tokio::fs::remove_file(dest).await.ok();
        let mut p = progress.lock();
        p.status = "hata".to_string();
        return Err(format!(
            "Indirme tamamlanamadi: {} / {} bayt. Tekrar deneyin.",
            final_size, total_size
        ));
    }

    {
        let mut p = progress.lock();
        p.status = "tamamlandi".to_string();
        p.percent = 100.0;
    }

    log::info!("Model indirildi: {:?} ({} bayt)", dest, final_size);
    Ok(())
}
