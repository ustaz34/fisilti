//! Tauri komutlari: Kullanici duzeltme sozlugu yonetimi

use crate::corrections;
use serde::Serialize;

#[derive(Serialize)]
pub struct UserCorrectionResponse {
    pub wrong: String,
    pub right: String,
    pub count: u32,
    pub last_seen: u64,
}

/// Sozluge duzeltme ekle
#[tauri::command]
pub fn add_user_correction(
    app_handle: tauri::AppHandle,
    wrong: String,
    right: String,
) -> Result<(), String> {
    if wrong.trim().is_empty() || right.trim().is_empty() {
        return Err("Bos kelime eklenemez".to_string());
    }
    if wrong.trim().to_lowercase() == right.trim().to_lowercase() {
        return Err("Yanlis ve dogru kelime ayni olamaz".to_string());
    }
    corrections::add_correction(&wrong.trim().to_lowercase(), right.trim());
    corrections::save_corrections(&app_handle);
    log::info!("Duzeltme eklendi: {} -> {}", wrong, right);
    Ok(())
}

/// Sozlukten duzeltme sil
#[tauri::command]
pub fn remove_user_correction(
    app_handle: tauri::AppHandle,
    wrong: String,
) -> Result<(), String> {
    if corrections::remove_correction(&wrong) {
        corrections::save_corrections(&app_handle);
        log::info!("Duzeltme silindi: {}", wrong);
        Ok(())
    } else {
        Err(format!("Duzeltme bulunamadi: {}", wrong))
    }
}

/// Tum duzeltmeleri getir
#[tauri::command]
pub fn get_user_corrections() -> Vec<UserCorrectionResponse> {
    corrections::get_all_corrections()
        .into_iter()
        .map(|c| UserCorrectionResponse {
            wrong: c.wrong,
            right: c.right,
            count: c.count,
            last_seen: c.last_seen,
        })
        .collect()
}

/// Duzenlenmis metinden ogren: kelime bazli diff yap, duzeltmeleri sozluge ekle
#[tauri::command]
pub fn learn_from_edit(
    app_handle: tauri::AppHandle,
    original_text: String,
    edited_text: String,
) -> Result<Vec<(String, String)>, String> {
    let pairs = corrections::learn_from_diff(&original_text, &edited_text);

    for (wrong, right) in &pairs {
        corrections::add_correction(wrong, right);
        corrections::increment_corrections_count();
    }

    if !pairs.is_empty() {
        corrections::save_corrections(&app_handle);
        corrections::save_profile(&app_handle);
        log::info!("Duzenlenmis metinden {} duzeltme ogrendi", pairs.len());
    }

    // N-gram ve sik kelime guncellemesi
    corrections::update_ngrams(&edited_text);
    corrections::update_frequent_words(&edited_text);
    corrections::save_profile(&app_handle);

    Ok(pairs)
}

/// Kullanici profil bilgisini getir
#[tauri::command]
pub fn get_user_profile() -> corrections::UserProfile {
    corrections::get_profile_snapshot()
}

/// Dinamik prompt onizleme (3 katman)
#[tauri::command]
pub fn get_dynamic_prompt_preview(language: String) -> corrections::DynamicPromptPreview {
    corrections::get_dynamic_prompt_preview(&language)
}

/// N-gram istatistikleri
#[tauri::command]
pub fn get_ngram_stats() -> Vec<corrections::NgramEntry> {
    corrections::get_ngram_stats()
}

/// Alan tespiti bilgisi
#[tauri::command]
pub fn get_domain_info() -> corrections::DomainInfo {
    corrections::get_domain_info()
}

/// Tum ogrenme verilerini sifirla
#[tauri::command]
pub fn reset_learning_data(app_handle: tauri::AppHandle) -> Result<(), String> {
    corrections::reset_learning_data(&app_handle);
    Ok(())
}

/// Duzeltmeleri JSON olarak disa aktar
#[tauri::command]
pub fn export_corrections() -> Result<String, String> {
    corrections::export_corrections()
}

/// JSON'dan duzeltmeleri ice aktar
#[tauri::command]
pub fn import_corrections(app_handle: tauri::AppHandle, json: String) -> Result<usize, String> {
    corrections::import_corrections(&json, &app_handle)
}
