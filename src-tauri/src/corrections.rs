//! Kullaniciya ozel duzeltme sozlugu ve ogrenme sistemi.
//!
//! 5 katmanli yaklasim:
//! 1. Duzeltme Sozlugu (post-processing)
//! 2. Dinamik Initial Prompt (Whisper baglam)
//! 3. Alan Tespiti (Domain Detection)
//! 4. N-gram Istatistikleri
//! 5. Confidence Takibi (frontend tarafinda)

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

const MAX_PROMPT_LENGTH: usize = 500;

// ─── Veri Yapilari ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserCorrection {
    pub wrong: String,
    pub right: String,
    pub count: u32,
    pub last_seen: u64,
    #[serde(default)]
    pub revert_count: u32,
    #[serde(default)]
    pub status: CorrectionStatus,
    #[serde(default)]
    pub first_seen: u64,
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CorrectionStore {
    pub corrections: Vec<UserCorrection>,
    #[serde(default)]
    pub version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Domain {
    General,
    Technical,
    Medical,
    Legal,
    Business,
}

impl Default for Domain {
    fn default() -> Self {
        Domain::General
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CorrectionStatus {
    Pending,
    Confirmed,
    Active,
    Deprecated,
}

impl Default for CorrectionStatus {
    fn default() -> Self {
        CorrectionStatus::Pending
    }
}

impl std::fmt::Display for Domain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Domain::General => write!(f, "Genel"),
            Domain::Technical => write!(f, "Teknik"),
            Domain::Medical => write!(f, "Tibbi"),
            Domain::Legal => write!(f, "Hukuki"),
            Domain::Business => write!(f, "Is"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NgramEntry {
    pub ngram: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserProfile {
    pub domain: Domain,
    pub frequent_words: Vec<String>,
    pub ngrams: Vec<NgramEntry>,
    pub total_transcriptions: u32,
    pub total_corrections: u32,
}

// ─── Yeni API Yapilari ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicPromptPreview {
    pub base_prompt: String,
    pub domain_addition: String,
    pub user_terms: String,
    pub total_length: usize,
    pub max_length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainInfo {
    pub detected: String,
    pub scores: HashMap<String, usize>,
    pub explanation: String,
}

// ─── Global State ───

static CORRECTION_STORE: OnceLock<RwLock<CorrectionStore>> = OnceLock::new();
static USER_PROFILE: OnceLock<RwLock<UserProfile>> = OnceLock::new();

fn get_correction_store() -> &'static RwLock<CorrectionStore> {
    CORRECTION_STORE.get_or_init(|| RwLock::new(CorrectionStore::default()))
}

fn get_user_profile() -> &'static RwLock<UserProfile> {
    USER_PROFILE.get_or_init(|| RwLock::new(UserProfile::default()))
}

// ─── Dosya Yollari ───

fn get_app_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn corrections_path(app_handle: &tauri::AppHandle) -> PathBuf {
    get_app_data_dir(app_handle).join("user_corrections.json")
}

fn profile_path(app_handle: &tauri::AppHandle) -> PathBuf {
    get_app_data_dir(app_handle).join("user_profile.json")
}

// ─── Yukleme / Kaydetme ───

pub fn load_corrections(app_handle: &tauri::AppHandle) {
    let path = corrections_path(app_handle);
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(mut store) = serde_json::from_str::<CorrectionStore>(&data) {
                // Migration: v1 -> v2
                if store.version < 2 {
                    for c in &mut store.corrections {
                        if c.first_seen == 0 {
                            c.first_seen = c.last_seen;
                        }
                        if c.source.is_empty() {
                            c.source = "diff".to_string();
                        }
                        if c.status == CorrectionStatus::Pending {
                            if c.count >= 3 {
                                c.status = CorrectionStatus::Active;
                            } else if c.count >= 1 {
                                c.status = CorrectionStatus::Confirmed;
                            }
                        }
                    }
                    store.version = 2;
                    log::info!("Duzeltme sozlugu v1 -> v2 goc tamamlandi");
                }
                let count = store.corrections.len();
                *get_correction_store().write() = store;
                log::info!("Duzeltme sozlugu yuklendi: {} kayit", count);
                return;
            }
        }
    }
    log::info!("Duzeltme sozlugu bos veya bulunamadi, sifirdan baslatiliyor");
}

pub fn save_corrections(app_handle: &tauri::AppHandle) {
    let path = corrections_path(app_handle);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let store = get_correction_store().read();
    if let Ok(json) = serde_json::to_string_pretty(&*store) {
        std::fs::write(&path, json).ok();
    }
}

pub fn load_profile(app_handle: &tauri::AppHandle) {
    let path = profile_path(app_handle);
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(profile) = serde_json::from_str::<UserProfile>(&data) {
                *get_user_profile().write() = profile;
                log::info!("Kullanici profili yuklendi");
                return;
            }
        }
    }
    log::info!("Kullanici profili bos, sifirdan baslatiliyor");
}

pub fn save_profile(app_handle: &tauri::AppHandle) {
    let path = profile_path(app_handle);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let profile = get_user_profile().read();
    if let Ok(json) = serde_json::to_string_pretty(&*profile) {
        std::fs::write(&path, json).ok();
    }
}

// ─── Turkce Stop-Word Filtresi ───

pub fn is_turkish_stopword(word: &str) -> bool {
    const STOPWORDS: &[&str] = &[
        "ve", "bir", "ile", "ben", "sen", "biz", "siz", "bu", "su", "o",
        "da", "de", "mi", "mu", "mü", "ki", "ama", "var", "yok", "ne",
        "hem", "her", "ise", "icin", "gibi", "kadar", "daha", "en",
        "cok", "az", "tam", "tum", "hep", "hic", "sey", "diye",
        "bana", "sana", "ona", "beni", "seni", "onu",
        "oldu", "olan", "olur", "etti", "eden", "eder",
        "dedi", "diyor", "der", "geldi", "gitti",
        "bunu", "sunu", "onu", "neden", "nasil", "nere",
    ];
    STOPWORDS.contains(&word)
}

// ─── CRUD Islemleri ───

/// Sozluge duzeltme ekle. Zaten varsa sayaci artir.
pub fn add_correction(wrong: &str, right: &str) {
    let mut store = get_correction_store().write();
    let lower_wrong = wrong.to_lowercase();
    let lower_right = right.to_lowercase();

    // Self-correction engelle: yanlis == dogru ise kaydetme
    if lower_wrong == lower_right {
        return;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    if let Some(existing) = store.corrections.iter_mut().find(|c| c.wrong.to_lowercase() == lower_wrong) {
        existing.right = right.to_string();
        existing.count += 1;
        existing.last_seen = now;
        // Status guncelle
        if existing.count >= MIN_CONFIRMATIONS && existing.status == CorrectionStatus::Pending {
            existing.status = CorrectionStatus::Confirmed;
        }
    } else {
        store.corrections.push(UserCorrection {
            wrong: wrong.to_lowercase(),
            right: right.to_string(),
            count: 1,
            last_seen: now,
            revert_count: 0,
            status: CorrectionStatus::Pending,
            first_seen: now,
            source: "diff".to_string(),
        });
    }
}

/// Sozlukten duzeltme sil
pub fn remove_correction(wrong: &str) -> bool {
    let mut store = get_correction_store().write();
    let lower_wrong = wrong.to_lowercase();
    let before = store.corrections.len();
    store.corrections.retain(|c| c.wrong.to_lowercase() != lower_wrong);
    store.corrections.len() < before
}

/// Tum duzeltmeleri getir
pub fn get_all_corrections() -> Vec<UserCorrection> {
    get_correction_store().read().corrections.clone()
}

/// Aktif duzeltme haritasi (sadece Active + confidence >= 0.5)
pub fn get_corrections_map() -> HashMap<String, String> {
    let store = get_correction_store().read();
    let mut map = HashMap::new();
    for c in &store.corrections {
        if c.wrong.to_lowercase() == c.right.to_lowercase() {
            continue; // Self-correction gurultu
        }
        // Sadece Active duzeltmeleri uygula (confidence >= 0.5)
        if c.status == CorrectionStatus::Active && calculate_confidence(c) >= AUTO_APPLY_CONFIDENCE {
            map.insert(c.wrong.clone(), c.right.clone());
        }
    }
    map
}

/// Tum duzeltmelerin haritasi (sayac filtresi yok, ayarlar paneli icin)
pub fn get_all_corrections_map() -> HashMap<String, String> {
    let store = get_correction_store().read();
    let mut map = HashMap::new();
    for c in &store.corrections {
        map.insert(c.wrong.clone(), c.right.clone());
    }
    map
}

// ─── Guven Skoru Motoru ───

/// Guven skoru hesapla: confidence = max(0, count - revert_count*2) * exp(-0.01 * gun_sayisi)
pub fn calculate_confidence(correction: &UserCorrection) -> f64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let days_since = if correction.last_seen > 0 {
        (now.saturating_sub(correction.last_seen)) as f64 / (1000.0 * 60.0 * 60.0 * 24.0)
    } else {
        0.0
    };
    let effective_count = (correction.count as i64 - correction.revert_count as i64 * 2).max(0) as f64;
    effective_count * (-0.01 * days_since).exp()
}

const MIN_CONFIRMATIONS: u32 = 3;
const AUTO_APPLY_CONFIDENCE: f64 = 0.5;
const DEPRECATION_THRESHOLD: f64 = 0.1;

/// Tum duzeltmelerin durumlarini yeniden hesapla
pub fn recalculate_all_statuses() {
    let mut store = get_correction_store().write();
    for c in &mut store.corrections {
        let conf = calculate_confidence(c);
        match c.status {
            CorrectionStatus::Pending => {
                if c.count >= MIN_CONFIRMATIONS || c.source == "manual" {
                    c.status = CorrectionStatus::Confirmed;
                }
            }
            CorrectionStatus::Confirmed => {
                if conf >= AUTO_APPLY_CONFIDENCE {
                    c.status = CorrectionStatus::Active;
                } else if conf < DEPRECATION_THRESHOLD && c.count > 0 {
                    c.status = CorrectionStatus::Deprecated;
                }
            }
            CorrectionStatus::Active => {
                if conf < AUTO_APPLY_CONFIDENCE {
                    if conf < DEPRECATION_THRESHOLD {
                        c.status = CorrectionStatus::Deprecated;
                    } else {
                        c.status = CorrectionStatus::Confirmed;
                    }
                }
            }
            CorrectionStatus::Deprecated => {
                // 90 gun sonra otomatik sil (periyodik bakim'da yapilacak)
            }
        }
    }
}

/// Negatif geri bildirim: kullanici pipeline duzeltmesini geri aldi
pub fn report_correction_revert(wrong: &str, right: &str) {
    let mut store = get_correction_store().write();
    let lower_wrong = wrong.to_lowercase();
    if let Some(c) = store.corrections.iter_mut().find(|c| c.wrong.to_lowercase() == lower_wrong && c.right.to_lowercase() == right.to_lowercase()) {
        c.revert_count += 1;
        log::info!("Duzeltme geri alindi: {} -> {} (revert_count: {})", wrong, right, c.revert_count);
    }
}

/// Duzeltmeyi yukselt (Pending/Confirmed -> Active)
pub fn promote_correction(wrong: &str) {
    let mut store = get_correction_store().write();
    let lower_wrong = wrong.to_lowercase();
    if let Some(c) = store.corrections.iter_mut().find(|c| c.wrong.to_lowercase() == lower_wrong) {
        match c.status {
            CorrectionStatus::Pending | CorrectionStatus::Confirmed => {
                c.status = CorrectionStatus::Active;
                c.source = "manual".to_string();
                log::info!("Duzeltme yukseltildi: {} -> Active", wrong);
            }
            _ => {}
        }
    }
}

/// Duzeltmeyi dusur (Active -> Deprecated)
pub fn demote_correction(wrong: &str) {
    let mut store = get_correction_store().write();
    let lower_wrong = wrong.to_lowercase();
    if let Some(c) = store.corrections.iter_mut().find(|c| c.wrong.to_lowercase() == lower_wrong) {
        c.status = CorrectionStatus::Deprecated;
        log::info!("Duzeltme dusuruldu: {} -> Deprecated", wrong);
    }
}

/// Govde cikarimli duzeltme ekle (daha fazla onay gerektirir)
pub fn add_stem_correction(wrong: &str, right: &str) {
    let mut store = get_correction_store().write();
    let lower_wrong = wrong.to_lowercase();
    let lower_right = right.to_lowercase();

    if lower_wrong == lower_right {
        return;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    if let Some(existing) = store.corrections.iter_mut().find(|c| c.wrong.to_lowercase() == lower_wrong) {
        existing.count += 1;
        existing.last_seen = now;
    } else {
        store.corrections.push(UserCorrection {
            wrong: wrong.to_lowercase(),
            right: right.to_string(),
            count: 0, // count: 0 — daha fazla onay gerektirir
            last_seen: now,
            revert_count: 0,
            status: CorrectionStatus::Pending,
            first_seen: now,
            source: "stem_inferred".to_string(),
        });
    }
}

/// Periyodik bakim: 90+ gun Deprecated olan duzeltmeleri sil
pub fn cleanup_deprecated() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let ninety_days_ms: u64 = 90 * 24 * 60 * 60 * 1000;

    let mut store = get_correction_store().write();
    store.corrections.retain(|c| {
        if c.status == CorrectionStatus::Deprecated {
            let age = now.saturating_sub(c.last_seen);
            if age > ninety_days_ms {
                log::info!("Deprecated duzeltme silindi: {} -> {}", c.wrong, c.right);
                return false;
            }
        }
        true
    });
}

/// Her N transkripsiyonda bir tam bakim yap
pub fn periodic_maintenance() {
    let profile = get_user_profile().read();
    if profile.total_transcriptions % 100 == 0 && profile.total_transcriptions > 0 {
        drop(profile); // Read lock'u birak
        recalculate_all_statuses();
        cleanup_deprecated();
        log::info!("Periyodik bakim tamamlandi (transkripsiyon #{})", get_user_profile().read().total_transcriptions);
    }
}

// ─── Katman 1: Kullanici Duzeltmeleri Uygulama ───

/// Metne kullanici duzeltmelerini uygula (tam kelime eslesmesi)
pub fn apply_user_corrections(text: &str, corrections: &HashMap<String, String>) -> String {
    if corrections.is_empty() {
        return text.to_string();
    }

    // Key uzunluguna gore azalan sirala — uzun eslesmeler once, deterministik
    let mut sorted: Vec<(&String, &String)> = corrections.iter().collect();
    sorted.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then_with(|| a.0.cmp(b.0)));

    let mut result = text.to_string();
    for (wrong, right) in sorted {
        result = replace_whole_word_unicode(&result, wrong, right);
    }
    result
}

fn is_word_char(ch: char) -> bool {
    ch.is_alphabetic() || ch == '\'' || ch == '\u{2019}'
}

fn replace_whole_word_unicode(text: &str, word: &str, replacement: &str) -> String {
    let mut result = String::new();
    let text_lower = text.to_lowercase();
    let word_lower = word.to_lowercase();
    let mut last_end = 0;

    for (idx, _) in text_lower.match_indices(&word_lower) {
        let before_ok = idx == 0 || {
            let prev_char = text[..idx].chars().last().unwrap_or(' ');
            !is_word_char(prev_char)
        };
        let after_idx = idx + word.len();
        let after_ok = after_idx >= text.len() || {
            let next_char = text[after_idx..].chars().next().unwrap_or(' ');
            !is_word_char(next_char)
        };

        if before_ok && after_ok {
            result.push_str(&text[last_end..idx]);
            // Buyuk harf koruma
            if text[idx..idx + 1].chars().next().map_or(false, |c| c.is_uppercase()) {
                let mut chars = replacement.chars();
                if let Some(first) = chars.next() {
                    result.push(first.to_uppercase().next().unwrap_or(first));
                    result.extend(chars);
                }
            } else {
                result.push_str(replacement);
            }
            last_end = after_idx;
        }
    }

    result.push_str(&text[last_end..]);
    result
}

// ─── Katman 2: Kelime Bazli Diff (Levenshtein) ───

/// Iki metin arasindaki kelime bazli farklari bul ve duzeltmeleri ogren.
/// Levenshtein mesafesi <= 2 olan degisiklikler "duzeltme" olarak sayilir.
/// Ek olarak: ekli kelimeler icin govde duzeltmesi de ogrenir.
/// Ornek: "biçimleri" → "bitimleri" duzeltmesinden "biçim" → "bitim" ogrenir.
/// Dondurur: (dogrudan_duzeltmeler, govde_cikarimli_duzeltmeler)
pub fn learn_from_diff(original: &str, edited: &str) -> (Vec<(String, String)>, Vec<(String, String)>) {
    let orig_words: Vec<&str> = original.split_whitespace().collect();
    let edit_words: Vec<&str> = edited.split_whitespace().collect();

    let mut learned = Vec::new();
    let mut stem_inferred = Vec::new();

    let process_pair = |ol: &str, el: &str, learned: &mut Vec<(String, String)>, stem_inferred: &mut Vec<(String, String)>| {
        if ol == el || ol.len() < 3 || is_turkish_stopword(ol) || is_turkish_stopword(el) {
            return;
        }
        let dist = levenshtein(ol, el);
        if dist > 0 && dist <= 2 {
            learned.push((ol.to_string(), el.to_string()));
        }

        // Ek-farkindalikli ogrenme: ortak eki soy, govdeleri karsilastir
        // Boylece "biçimleri" → "bitimleri" = "biçim" → "bitim" ogrenir
        let (o_stem, o_suffix) = crate::text::strip_turkish_suffixes_pub(ol);
        let (e_stem, e_suffix) = crate::text::strip_turkish_suffixes_pub(el);

        // Ayni eke sahiplerse VE govdeler farkliysa → govde duzeltmesi ogren
        if !o_suffix.is_empty() && o_suffix == e_suffix && o_stem != e_stem {
            let stem_dist = levenshtein(&o_stem, &e_stem);
            if stem_dist > 0 && stem_dist <= 2 && o_stem.len() >= 3 {
                // Govde cikarimi — daha fazla onay gerektirir (stem_inferred)
                if !learned.iter().any(|(w, _)| w == &o_stem) && !stem_inferred.iter().any(|(w, _)| w == &o_stem) {
                    stem_inferred.push((o_stem, e_stem));
                }
            }
        }
    };

    // Basit hizalama: ayni uzunlukta ise birebir karsilastir
    if orig_words.len() == edit_words.len() {
        for (o, e) in orig_words.iter().zip(edit_words.iter()) {
            let ol = o.to_lowercase();
            let el = e.to_lowercase();
            process_pair(&ol, &el, &mut learned, &mut stem_inferred);
        }
    } else {
        // Farkli uzunlukta: LCS tabanli hizalama
        let aligned = align_words(&orig_words, &edit_words);
        for (o, e) in aligned {
            if let (Some(orig_w), Some(edit_w)) = (o, e) {
                let ol = orig_w.to_lowercase();
                let el = edit_w.to_lowercase();
                process_pair(&ol, &el, &mut learned, &mut stem_inferred);
            }
        }
    }

    (learned, stem_inferred)
}

/// Public Levenshtein mesafesi hesaplama (text.rs'den erisim icin)
pub fn levenshtein(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let m = a_chars.len();
    let n = b_chars.len();

    if m == 0 { return n; }
    if n == 0 { return m; }

    let mut prev = (0..=n).collect::<Vec<_>>();
    let mut curr = vec![0; n + 1];

    for i in 1..=m {
        curr[0] = i;
        for j in 1..=n {
            let cost = if a_chars[i - 1] == b_chars[j - 1] { 0 } else { 1 };
            curr[j] = (prev[j] + 1).min(curr[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }

    prev[n]
}

/// Basit kelime hizalama (LCS tabanli)
fn align_words<'a>(orig: &[&'a str], edit: &[&'a str]) -> Vec<(Option<String>, Option<String>)> {
    let m = orig.len();
    let n = edit.len();
    let mut dp = vec![vec![0u32; n + 1]; m + 1];

    for i in 1..=m {
        for j in 1..=n {
            if orig[i - 1].to_lowercase() == edit[j - 1].to_lowercase() {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
            }
        }
    }

    // Backtrack
    let mut result = Vec::new();
    let mut i = m;
    let mut j = n;

    while i > 0 || j > 0 {
        if i > 0 && j > 0 && orig[i - 1].to_lowercase() == edit[j - 1].to_lowercase() {
            result.push((Some(orig[i - 1].to_string()), Some(edit[j - 1].to_string())));
            i -= 1;
            j -= 1;
        } else if i > 0 && j > 0 && dp[i - 1][j - 1] >= dp[i - 1][j] && dp[i - 1][j - 1] >= dp[i][j - 1] {
            // Substitution
            result.push((Some(orig[i - 1].to_string()), Some(edit[j - 1].to_string())));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            result.push((None, Some(edit[j - 1].to_string())));
            j -= 1;
        } else {
            result.push((Some(orig[i - 1].to_string()), None));
            i -= 1;
        }
    }

    result.reverse();
    result
}

// ─── Katman 3: Alan Tespiti ───

pub fn detect_domain(history_texts: &[String]) -> Domain {
    use std::collections::HashSet;

    static TECH_KEYWORDS: &[&str] = &["api", "server", "deploy", "bug", "commit", "frontend", "backend",
        "database", "kod", "yazılım", "program", "fonksiyon", "değişken", "class", "git"];
    static MEDICAL_KEYWORDS: &[&str] = &["hasta", "tedavi", "ilaç", "doktor", "ameliyat", "teşhis",
        "reçete", "hastane", "klinik", "semptom", "muayene", "tansiyon"];
    static LEGAL_KEYWORDS: &[&str] = &["mahkeme", "dava", "avukat", "kanun", "hukuk", "savcı",
        "hakim", "sözleşme", "madde", "ihlal", "karar", "temyiz"];
    static BUSINESS_KEYWORDS: &[&str] = &["toplantı", "proje", "rapor", "müşteri", "satış",
        "pazarlama", "bütçe", "strateji", "hedef", "performans", "yönetim"];

    let mut tech_score: f64 = 0.0;
    let mut medical_score: f64 = 0.0;
    let mut legal_score: f64 = 0.0;
    let mut business_score: f64 = 0.0;

    for (i, text) in history_texts.iter().take(100).enumerate() {
        // Temporal weighting: son 10 → 3x, son 30 → 2x, geri kalan → 1x
        let weight = if i < 10 { 3.0 } else if i < 30 { 2.0 } else { 1.0 };

        let words: HashSet<String> = text.to_lowercase()
            .split_whitespace()
            .map(|w| w.to_string())
            .collect();

        tech_score += TECH_KEYWORDS.iter().filter(|k| words.contains(**k)).count() as f64 * weight;
        medical_score += MEDICAL_KEYWORDS.iter().filter(|k| words.contains(**k)).count() as f64 * weight;
        legal_score += LEGAL_KEYWORDS.iter().filter(|k| words.contains(**k)).count() as f64 * weight;
        business_score += BUSINESS_KEYWORDS.iter().filter(|k| words.contains(**k)).count() as f64 * weight;
    }

    let max_score = tech_score.max(medical_score).max(legal_score).max(business_score);

    if max_score < 5.0 {
        return Domain::General;
    }

    if tech_score == max_score { Domain::Technical }
    else if medical_score == max_score { Domain::Medical }
    else if legal_score == max_score { Domain::Legal }
    else if business_score == max_score { Domain::Business }
    else { Domain::General }
}

// ─── Katman 4: N-gram Cikarma ───

pub fn extract_ngrams(text: &str) -> Vec<(String, u32)> {
    let words: Vec<&str> = text
        .split_whitespace()
        .filter(|w| w.len() > 1)
        .collect();

    let mut ngram_counts: HashMap<String, u32> = HashMap::new();

    // 2-gram
    for window in words.windows(2) {
        let ngram = format!("{} {}", window[0].to_lowercase(), window[1].to_lowercase());
        *ngram_counts.entry(ngram).or_insert(0) += 1;
    }

    // 3-gram
    for window in words.windows(3) {
        let ngram = format!("{} {} {}", window[0].to_lowercase(), window[1].to_lowercase(), window[2].to_lowercase());
        *ngram_counts.entry(ngram).or_insert(0) += 1;
    }

    ngram_counts.into_iter().collect()
}

/// N-gram istatistiklerini profilde guncelle
pub fn update_ngrams(text: &str) {
    let new_ngrams = extract_ngrams(text);
    let mut profile = get_user_profile().write();

    for (ngram, count) in new_ngrams {
        if let Some(existing) = profile.ngrams.iter_mut().find(|n| n.ngram == ngram) {
            existing.count += count;
        } else {
            profile.ngrams.push(NgramEntry { ngram, count });
        }
    }

    // En fazla 500 n-gram sakla (count'a gore sirali)
    profile.ngrams.sort_by(|a, b| b.count.cmp(&a.count));
    profile.ngrams.truncate(500);

    profile.total_transcriptions += 1;
}

/// Sik kelimeleri profilde guncelle (stop-word ve kisa kelimeler filtrelenir)
pub fn update_frequent_words(text: &str) {
    let words: Vec<String> = text
        .split_whitespace()
        .filter(|w| w.len() > 3)
        .map(|w| w.to_lowercase())
        .filter(|w| !is_turkish_stopword(w))
        .collect();

    let mut profile = get_user_profile().write();

    // Kelime frekanslarini say
    let mut word_counts: HashMap<String, u32> = HashMap::new();
    for word in &profile.frequent_words {
        *word_counts.entry(word.clone()).or_insert(0) += 1;
    }
    for word in &words {
        *word_counts.entry(word.clone()).or_insert(0) += 1;
    }

    // En sik 50 kelimeyi sakla
    let mut sorted: Vec<(String, u32)> = word_counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    sorted.truncate(50);

    profile.frequent_words = sorted.into_iter().map(|(w, _)| w).collect();
}

// ─── Katman 2: Dinamik Prompt Olusturucu ───

/// 3 katmanli dinamik prompt olustur:
/// 1. Dil bazli temel prompt
/// 2. + Domain-spesifik terimler
/// 3. + Kullanici sik kelimeleri + n-gram'lar (max 300 karakter)
pub fn build_dynamic_prompt(language: &str) -> String {
    let profile = get_user_profile().read();

    // Katman 1: Dil bazli temel prompt (Turkce fonem kapsamini genislet)
    let base = match language {
        "tr" => "Merhaba, bugün hava çok güzel. Nasılsınız? İstanbul çok kalabalık bir şehir. Şirketin toplantısında bütçeyi görüştük. Çocuklar okula gidiyor. Öğretmen ödevleri kontrol etti. Müşteri memnuniyeti çok önemli. Türkiye'de yaşıyorum.",
        "en" => "Hello, how are you today? I'm doing well, thank you.",
        "de" => "Hallo, wie geht es Ihnen? Mir geht es gut, danke.",
        "fr" => "Bonjour, comment allez-vous? Je vais bien, merci.",
        "es" => "Hola, ¿cómo estás? Estoy bien, gracias.",
        "it" => "Ciao, come stai? Sto bene, grazie.",
        "pt" => "Olá, como vai? Estou bem, obrigado.",
        "ru" => "Здравствуйте, как дела? У меня всё хорошо.",
        "ja" => "こんにちは、お元気ですか？元気です。",
        "zh" => "你好，你怎么样？我很好。",
        _ => "Hello, how are you?",
    };

    let mut prompt = base.to_string();

    // Katman 2: Domain-spesifik terimler
    let domain_addition = match (&profile.domain, language) {
        (Domain::Technical, "tr") => " Meeting'e gidiyorum. Deploy etmemiz lazım. API endpoint düzelt. Sprint planning yapacağız.",
        (Domain::Medical, "tr") => " Hasta muayene edildi. Tedavi planı hazırlandı. Reçete yazıldı. Tansiyon ölçüldü.",
        (Domain::Legal, "tr") => " Mahkeme kararı açıklandı. Dava dosyası incelendi. Sözleşme maddeleri düzenlendi.",
        (Domain::Business, "tr") => " Toplantı raporu hazırlandı. Müşteri görüşmesi yapıldı. Bütçe planlaması tamamlandı.",
        (Domain::Technical, "en") => " Let's deploy the API. Check the server logs. Push the commit.",
        _ => "",
    };
    prompt.push_str(domain_addition);

    // Katman 3: Kullanici sik kelimeleri + n-gram'lar
    let remaining = MAX_PROMPT_LENGTH.saturating_sub(prompt.len());
    if remaining > 20 {
        let mut user_terms = String::new();

        // Sik kelimeleri ekle (en fazla 15-20)
        for word in profile.frequent_words.iter().take(20) {
            if user_terms.len() + word.len() + 2 > remaining {
                break;
            }
            if !user_terms.is_empty() {
                user_terms.push_str(", ");
            }
            user_terms.push_str(word);
        }

        // N-gram'lari ekle (en sik 5 bigram)
        let bigrams: Vec<&NgramEntry> = profile.ngrams.iter()
            .filter(|n| n.ngram.split_whitespace().count() == 2)
            .take(5)
            .collect();

        for ng in bigrams {
            if user_terms.len() + ng.ngram.len() + 2 > remaining {
                break;
            }
            if !user_terms.is_empty() {
                user_terms.push_str(", ");
            }
            user_terms.push_str(&ng.ngram);
        }

        if !user_terms.is_empty() {
            prompt.push(' ');
            prompt.push_str(&user_terms);
        }
    }

    // Max 500 karakter siniri (Turkce morfoloji icin daha genis prompt gerekir)
    if prompt.len() > MAX_PROMPT_LENGTH {
        // UTF-8 guvenli truncate — cumle sinirinda kes
        let mut end = MAX_PROMPT_LENGTH;
        while !prompt.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        if let Some(last_period) = prompt[..end].rfind(". ") {
            end = last_period + 1;
        }
        prompt.truncate(end);
    }

    prompt
}

/// Domain'i kullanici gecmisinden guncelle
pub fn update_domain(history_texts: &[String]) {
    let domain = detect_domain(history_texts);
    let mut profile = get_user_profile().write();
    profile.domain = domain;
}

/// Profildeki toplam duzeltme sayisini artir
pub fn increment_corrections_count() {
    let mut profile = get_user_profile().write();
    profile.total_corrections += 1;
}

/// Profili oku (frontend icin)
pub fn get_profile_snapshot() -> UserProfile {
    get_user_profile().read().clone()
}

// ─── Yeni API Fonksiyonlari ───

/// Dinamik prompt'u 3 katman olarak ayri dondur
pub fn get_dynamic_prompt_preview(language: &str) -> DynamicPromptPreview {
    let profile = get_user_profile().read();

    // Katman 1: Dil bazli temel prompt
    let base_prompt = match language {
        "tr" => "Merhaba, bugün hava çok güzel. Nasılsınız? İstanbul çok kalabalık bir şehir.",
        "en" => "Hello, how are you today? I'm doing well, thank you.",
        "de" => "Hallo, wie geht es Ihnen? Mir geht es gut, danke.",
        "fr" => "Bonjour, comment allez-vous? Je vais bien, merci.",
        "es" => "Hola, ¿cómo estás? Estoy bien, gracias.",
        "it" => "Ciao, come stai? Sto bene, grazie.",
        "pt" => "Olá, como vai? Estou bem, obrigado.",
        "ru" => "Здравствуйте, как дела? У меня всё хорошо.",
        "ja" => "こんにちは、お元気ですか？元気です。",
        "zh" => "你好，你怎么样？我很好。",
        _ => "Hello, how are you?",
    }.to_string();

    // Katman 2: Domain-spesifik terimler
    let domain_addition = match (&profile.domain, language) {
        (Domain::Technical, "tr") => " Meeting'e gidiyorum. Deploy etmemiz lazım. API endpoint düzelt. Sprint planning yapacağız.".to_string(),
        (Domain::Medical, "tr") => " Hasta muayene edildi. Tedavi planı hazırlandı. Reçete yazıldı. Tansiyon ölçüldü.".to_string(),
        (Domain::Legal, "tr") => " Mahkeme kararı açıklandı. Dava dosyası incelendi. Sözleşme maddeleri düzenlendi.".to_string(),
        (Domain::Business, "tr") => " Toplantı raporu hazırlandı. Müşteri görüşmesi yapıldı. Bütçe planlaması tamamlandı.".to_string(),
        (Domain::Technical, "en") => " Let's deploy the API. Check the server logs. Push the commit.".to_string(),
        _ => String::new(),
    };

    // Katman 3: Kullanici sik kelimeleri + n-gram'lar
    let total_base = base_prompt.len() + domain_addition.len();
    let remaining = MAX_PROMPT_LENGTH.saturating_sub(total_base);
    let mut user_terms = String::new();

    if remaining > 20 {
        for word in profile.frequent_words.iter().take(20) {
            if user_terms.len() + word.len() + 2 > remaining { break; }
            if !user_terms.is_empty() { user_terms.push_str(", "); }
            user_terms.push_str(word);
        }

        let bigrams: Vec<&NgramEntry> = profile.ngrams.iter()
            .filter(|n| n.ngram.split_whitespace().count() == 2)
            .take(5)
            .collect();

        for ng in bigrams {
            if user_terms.len() + ng.ngram.len() + 2 > remaining { break; }
            if !user_terms.is_empty() { user_terms.push_str(", "); }
            user_terms.push_str(&ng.ngram);
        }
    }

    let total_length = base_prompt.len() + domain_addition.len() + if user_terms.is_empty() { 0 } else { user_terms.len() + 1 };

    DynamicPromptPreview {
        base_prompt,
        domain_addition,
        user_terms,
        total_length: total_length.min(MAX_PROMPT_LENGTH),
        max_length: MAX_PROMPT_LENGTH,
    }
}

/// N-gram istatistiklerini dondur
pub fn get_ngram_stats() -> Vec<NgramEntry> {
    let profile = get_user_profile().read();
    profile.ngrams.clone()
}

/// Alan tespiti bilgisi + skor dagilimi + Turkce aciklama
pub fn get_domain_info() -> DomainInfo {
    let profile = get_user_profile().read();

    let mut scores = HashMap::new();
    scores.insert("Teknik".to_string(), 0usize);
    scores.insert("Tibbi".to_string(), 0usize);
    scores.insert("Hukuki".to_string(), 0usize);
    scores.insert("Is".to_string(), 0usize);

    let explanation = match &profile.domain {
        Domain::General => "Henuz yeterli veri yok veya genel kullanim tespit edildi.".to_string(),
        Domain::Technical => "Teknik terimler yogun kullaniliyor. Yazilim ve teknoloji odakli prompt olusturuluyor.".to_string(),
        Domain::Medical => "Tibbi terimler tespit edildi. Saglik alani odakli prompt olusturuluyor.".to_string(),
        Domain::Legal => "Hukuki terimler tespit edildi. Hukuk alani odakli prompt olusturuluyor.".to_string(),
        Domain::Business => "Is terimleri tespit edildi. Is/yonetim odakli prompt olusturuluyor.".to_string(),
    };

    DomainInfo {
        detected: profile.domain.to_string(),
        scores,
        explanation,
    }
}

/// Tum ogrenme verilerini sifirla
pub fn reset_learning_data(app_handle: &tauri::AppHandle) {
    *get_correction_store().write() = CorrectionStore::default();
    *get_user_profile().write() = UserProfile::default();
    save_corrections(app_handle);
    save_profile(app_handle);
    log::info!("Tum ogrenme verileri sifirlandi");
}

/// Duzeltmeleri JSON olarak disa aktar
pub fn export_corrections() -> Result<String, String> {
    let store = get_correction_store().read();
    serde_json::to_string_pretty(&*store)
        .map_err(|e| format!("JSON serializasyon hatasi: {}", e))
}

/// JSON'dan duzeltmeleri ice aktar
pub fn import_corrections(json: &str, app_handle: &tauri::AppHandle) -> Result<usize, String> {
    let imported: CorrectionStore = serde_json::from_str(json)
        .map_err(|e| format!("JSON parse hatasi: {}", e))?;
    let count = imported.corrections.len();
    *get_correction_store().write() = imported;
    save_corrections(app_handle);
    log::info!("{} duzeltme ice aktarildi", count);
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_levenshtein() {
        assert_eq!(levenshtein("kitten", "sitting"), 3);
        assert_eq!(levenshtein("hello", "hello"), 0);
        assert_eq!(levenshtein("guzel", "güzel"), 1);
        assert_eq!(levenshtein("cok", "çok"), 1);
    }

    #[test]
    fn test_learn_from_diff() {
        let (pairs, _stem_pairs) = learn_from_diff("cok guzel bir gun", "çok güzel bir gün");
        assert!(!pairs.is_empty());
        // "cok" is a stopword, should NOT be learned
        assert!(!pairs.iter().any(|(w, _)| w == "cok"), "stopword 'cok' should be filtered");
        // "guzel" should be learned
        assert!(pairs.iter().any(|(w, r)| w == "guzel" && r == "güzel"));
    }

    #[test]
    fn test_learn_from_diff_stopword_filter() {
        // Stop-word'ler ogrenilmemeli
        let (pairs, _stem_pairs) = learn_from_diff("ve ben bir ile", "vee benn birr ilee");
        assert!(pairs.is_empty(), "stopword pairs should be filtered: {:?}", pairs);
    }

    #[test]
    fn test_is_turkish_stopword() {
        assert!(is_turkish_stopword("ve"));
        assert!(is_turkish_stopword("bir"));
        assert!(is_turkish_stopword("ben"));
        assert!(!is_turkish_stopword("guzel"));
        assert!(!is_turkish_stopword("program"));
    }

    #[test]
    fn test_self_correction_blocked() {
        // Self-correction: wrong == right olmamali
        add_correction("bozuldu", "bozuldu");
        let store = get_correction_store().read();
        // Eklenmemis olmali
        assert!(!store.corrections.iter().any(|c| c.wrong == "bozuldu" && c.right == "bozuldu"),
            "self-correction should be blocked");
    }

    #[test]
    fn test_extract_ngrams() {
        let ngrams = extract_ngrams("bugün hava çok güzel");
        assert!(ngrams.iter().any(|(n, _)| n == "bugün hava"));
        assert!(ngrams.iter().any(|(n, _)| n == "hava çok"));
        assert!(ngrams.iter().any(|(n, _)| n == "bugün hava çok"));
    }

    #[test]
    fn test_detect_domain() {
        let tech = vec!["api server deploy bug commit frontend backend database".to_string()];
        assert_eq!(detect_domain(&tech), Domain::Technical);

        let medical = vec!["hasta tedavi ilaç doktor ameliyat teşhis reçete hastane klinik".to_string()];
        assert_eq!(detect_domain(&medical), Domain::Medical);

        let general = vec!["bugün hava güzel".to_string()];
        assert_eq!(detect_domain(&general), Domain::General);
    }

    #[test]
    fn test_apply_user_corrections() {
        let mut map = HashMap::new();
        map.insert("yanlis".to_string(), "doğru".to_string());
        let result = apply_user_corrections("bu yanlis bir kelime", &map);
        assert_eq!(result, "bu doğru bir kelime");
    }

    #[test]
    fn test_replace_whole_word() {
        let result = replace_whole_word_unicode("çok güzel", "ok", "tamam");
        // "ok" should NOT match inside "çok" because ç is a word char
        assert_eq!(result, "çok güzel");
    }
}
