/// Edge TTS Service — Microsoft Edge neural ses sentezi (Rust backend)
/// WebSocket uzerinden SSML gonderir, MP3 audio alir
/// Tauri command olarak frontend'e base64 encoded MP3 dondurur

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

/// Kelime siniri verisi — Edge TTS metadata'sindan parse edilir
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WordBoundary {
    /// Audio offset (100ns ticks cinsinden)
    pub audio_offset_ticks: u64,
    /// Kelimenin suresi (100ns ticks cinsinden)
    pub duration_ticks: u64,
    /// Kelime metni
    pub text: String,
    /// Kelime uzunlugu (karakter)
    pub text_length: u32,
    /// Orijinal metindeki karakter pozisyonu
    pub text_offset: u32,
}

const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SEC_MS_GEC_VERSION: &str = "1-143.0.3650.75";
const CHROMIUM_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

/// Microsoft'un Edge TTS icin gerektirdigi Sec-MS-GEC guvenlik token'i olusturur
/// Windows FILETIME bazli, 5 dakikalik araliklara yuvarlanmis SHA-256 hash
fn generate_sec_ms_gec() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let unix_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // Windows FILETIME: 100ns araliklarla 1601-01-01'den itibaren
    let ticks = (unix_secs + 11_644_473_600) * 10_000_000;
    // 5 dakikalik araliğa yuvarla (300 saniye = 3_000_000_000 tick)
    let rounded = ticks - (ticks % 3_000_000_000);

    let to_hash = format!("{}{}", rounded, TRUSTED_CLIENT_TOKEN);

    let mut hasher = Sha256::new();
    hasher.update(to_hash.as_bytes());
    let result = hasher.finalize();

    // Buyuk harfli hex
    result.iter().map(|b| format!("{:02X}", b)).collect::<String>()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EdgeVoice {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "ShortName")]
    pub short_name: String,
    #[serde(rename = "Gender")]
    pub gender: String,
    #[serde(rename = "Locale")]
    pub locale: String,
    #[serde(rename = "FriendlyName")]
    pub friendly_name: String,
}

/// Edge TTS ses listesini HTTP ile ceker
pub async fn fetch_voices() -> Result<Vec<EdgeVoice>, String> {
    eprintln!("[edge-tts] Ses listesi cekiliyor...");
    let url = format!(
        "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken={}",
        TRUSTED_CLIENT_TOKEN
    );
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", CHROMIUM_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Ses listesi alinamadi: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Ses listesi alinamadi: HTTP {}", resp.status()));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Yanit okunamadi: {}", e))?;
    let voices: Vec<EdgeVoice> =
        serde_json::from_str(&text).map_err(|e| format!("JSON parse hatasi: {}", e))?;
    eprintln!("[edge-tts] {} ses yuklendi", voices.len());
    Ok(voices)
}

/// Benzersiz hex ID uretir — atomik sayac ile cakisma onlenir
fn generate_hex_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::SystemTime;
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let d = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "{:08x}{:08x}{:08x}{:08x}",
        d.as_secs() as u32,
        d.subsec_nanos(),
        seq as u32,
        (d.subsec_nanos() ^ (seq as u32).wrapping_mul(2654435761))
    )
}

fn generate_muid() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::SystemTime;
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let d = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap();
    let seed = d.as_nanos();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "{:08X}{:08X}{:08X}{:08X}",
        (seed >> 64) as u32 ^ 0xDEAD_BEEF ^ seq as u32,
        (seed >> 32) as u32 ^ 0xCAFE_BABE,
        seed as u32 ^ 0x1234_5678,
        (seq as u32).wrapping_mul(2654435761) ^ 0xABCD_EF01
    )
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Metni SSML icin temizler: kontrol karakterleri, BOM, sifir genislikli bosluklar vb.
fn sanitize_text(text: &str) -> String {
    text.chars()
        .filter(|c| {
            // Kontrol karakterlerini kaldir (tab, newline haric)
            if c.is_control() && *c != '\n' && *c != '\r' && *c != '\t' {
                return false;
            }
            // BOM ve sifir genislikli karakterleri kaldir
            !matches!(*c, '\u{FEFF}' | '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FFFE}')
        })
        .map(|c| {
            // Newline ve tab'i bosluga cevir
            if c == '\n' || c == '\r' || c == '\t' {
                ' '
            } else {
                c
            }
        })
        .collect::<String>()
        // Ardisik bosluklari tek bosluga indirge
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

/// Metni SSML icin hazirlar — XML escape uygular
/// Not: Edge TTS <lang> tag'ini desteklemiyor, bu yuzden sadece escape yapiyoruz
/// Neural sesler zaten karma dilli metni makul telaffuz ediyor
fn prepare_ssml_text(text: &str) -> String {
    escape_xml(text)
}

fn build_ssml(text: &str, voice: &str, rate: f64, pitch: f64, volume: f64) -> String {
    let rate_pct = ((rate - 1.0) * 100.0).round() as i32;
    let rate_str = if rate_pct >= 0 {
        format!("+{}%", rate_pct)
    } else {
        format!("{}%", rate_pct)
    };

    let pitch_hz = ((pitch - 1.0) * 50.0).round() as i32;
    let pitch_str = if pitch_hz >= 0 {
        format!("+{}Hz", pitch_hz)
    } else {
        format!("{}Hz", pitch_hz)
    };

    let vol_pct = ((volume - 1.0) * 100.0).round() as i32;
    let vol_str = if vol_pct >= 0 {
        format!("+{}%", vol_pct)
    } else {
        format!("{}%", vol_pct)
    };

    let lang: String = voice.splitn(3, '-').take(2).collect::<Vec<&str>>().join("-");

    let clean_text = sanitize_text(text);

    format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='{}'>\
         <voice name='{}'>\
         <prosody rate='{}' pitch='{}' volume='{}'>\
         {}\
         </prosody></voice></speak>",
        lang,
        voice,
        rate_str,
        pitch_str,
        vol_str,
        prepare_ssml_text(&clean_text)
    )
}

/// Edge TTS ile metni sentezler, MP3 byte array dondurur
/// Bos audio durumunda otomatik retry yapar (maks 3 deneme)
pub async fn synthesize(
    text: &str,
    voice: &str,
    rate: f64,
    pitch: f64,
    volume: f64,
) -> Result<Vec<u8>, String> {
    let (audio, _boundaries) = synthesize_with_boundaries(text, voice, rate, pitch, volume).await?;
    Ok(audio)
}

/// Edge TTS ile metni sentezler, MP3 audio + kelime sinirlari dondurur
pub async fn synthesize_with_boundaries(
    text: &str,
    voice: &str,
    rate: f64,
    pitch: f64,
    volume: f64,
) -> Result<(Vec<u8>, Vec<WordBoundary>), String> {
    // Bos metin kontrolu
    let clean = sanitize_text(text);
    if clean.trim().is_empty() {
        return Err("Metin bos, seslendirme iptal".to_string());
    }

    let mut last_err = String::new();
    for attempt in 0..3 {
        match synthesize_inner(text, voice, rate, pitch, volume).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_err = e;
                if attempt < 2 {
                    eprintln!("[edge-tts] Deneme {} basarisiz, {}ms sonra tekrar deneniyor...", attempt + 1, (attempt + 1) * 200);
                    tokio::time::sleep(std::time::Duration::from_millis((attempt as u64 + 1) * 200)).await;
                }
            }
        }
    }

    Err(last_err)
}

async fn synthesize_inner(
    text: &str,
    voice: &str,
    rate: f64,
    pitch: f64,
    volume: f64,
) -> Result<(Vec<u8>, Vec<WordBoundary>), String> {
    let clean = sanitize_text(text);
    let connection_id = generate_hex_id();
    let request_id = generate_hex_id();

    eprintln!(
        "[edge-tts] Sentez basliyor: voice={}, text_len={}, clean_len={}, rate={}, pitch={}, volume={}",
        voice,
        text.len(),
        clean.len(),
        rate,
        pitch,
        volume
    );

    let sec_ms_gec = generate_sec_ms_gec();
    let muid = generate_muid();
    // Python edge-tts ile birebir ayni: Sec-MS-GEC ve Version URL parametresi
    let url = format!(
        "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken={}&ConnectionId={}&Sec-MS-GEC={}&Sec-MS-GEC-Version={}",
        TRUSTED_CLIENT_TOKEN, connection_id, sec_ms_gec, SEC_MS_GEC_VERSION
    );

    eprintln!("[edge-tts] WebSocket URL: ...GEC={}&Version={}", &sec_ms_gec[..8], SEC_MS_GEC_VERSION);

    // IntoClientRequest ile URL'den request olustur, sonra WSS header'lari ekle
    let mut request = url.into_client_request()
        .map_err(|e| format!("Request olusturulamadi: {}", e))?;
    {
        let headers = request.headers_mut();
        headers.insert("Pragma", "no-cache".parse().unwrap());
        headers.insert("Cache-Control", "no-cache".parse().unwrap());
        headers.insert("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold".parse().unwrap());
        headers.insert("User-Agent", CHROMIUM_USER_AGENT.parse().unwrap());
        headers.insert("Accept-Encoding", "gzip, deflate, br, zstd".parse().unwrap());
        headers.insert("Accept-Language", "en-US,en;q=0.9".parse().unwrap());
        headers.insert("Cookie", format!("muid={};", muid).parse().unwrap());
    }

    let tls_connector = native_tls::TlsConnector::builder()
        .min_protocol_version(Some(native_tls::Protocol::Tlsv12))
        .build()
        .map_err(|e| format!("TLS connector hatasi: {}", e))?;

    let (mut ws, _) = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio_tungstenite::connect_async_tls_with_config(
            request,
            None,
            false,
            Some(tokio_tungstenite::Connector::NativeTls(tls_connector)),
        ),
    )
    .await
    .map_err(|_| {
        eprintln!("[edge-tts] WebSocket baglanti zaman asimi (10s)!");
        "WebSocket baglanti zaman asimi (10s)".to_string()
    })?
    .map_err(|e| {
        eprintln!("[edge-tts] WebSocket baglanti hatasi: {}", e);
        format!("WebSocket baglanti hatasi: {}", e)
    })?;

    eprintln!("[edge-tts] WebSocket baglandi, config gonderiliyor...");

    // Config mesaji
    let config = serde_json::json!({
        "context": {
            "synthesis": {
                "audio": {
                    "metadataoptions": {
                        "sentenceBoundaryEnabled": "false",
                        "wordBoundaryEnabled": "true"
                    },
                    "outputFormat": "audio-24khz-48kbitrate-mono-mp3"
                }
            }
        }
    });

    let config_msg = format!(
        "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{}",
        config
    );
    ws.send(Message::Text(config_msg))
        .await
        .map_err(|e| format!("Config mesaji gonderilemedi: {}", e))?;

    // SSML mesaji
    let ssml = build_ssml(text, voice, rate, pitch, volume);
    eprintln!("[edge-tts] SSML: {}", &ssml[..ssml.len().min(300)]);
    let ssml_msg = format!(
        "X-RequestId:{}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n{}",
        request_id, ssml
    );
    ws.send(Message::Text(ssml_msg))
        .await
        .map_err(|e| format!("SSML mesaji gonderilemedi: {}", e))?;

    eprintln!("[edge-tts] SSML gonderildi, audio bekleniyor...");

    // Audio verisi ve word boundary metadata'si al
    let mut audio_chunks: Vec<Vec<u8>> = Vec::new();
    let mut word_boundaries: Vec<WordBoundary> = Vec::new();

    let result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while let Some(msg) = ws.next().await {
            match msg {
                Ok(Message::Binary(data)) => {
                    if data.len() < 2 {
                        continue;
                    }
                    let header_len = u16::from_be_bytes([data[0], data[1]]) as usize;
                    let data_start = 2 + header_len;
                    if data_start >= data.len() {
                        continue;
                    }
                    let header = String::from_utf8_lossy(&data[2..data_start]);
                    if header.contains("Path:audio") {
                        audio_chunks.push(data[data_start..].to_vec());
                    }
                }
                Ok(Message::Text(txt)) => {
                    // Tum sunucu mesajlarini logla (hata teshis icin)
                    if txt.contains("Path:turn.start") {
                        eprintln!("[edge-tts] turn.start alindi");
                    } else if txt.contains("Path:turn.end") {
                        eprintln!("[edge-tts] turn.end alindi");
                        break;
                    } else if txt.contains("Path:audio.metadata") {
                        // Word boundary metadata parse et
                        if let Some(json_start) = txt.find("\r\n\r\n") {
                            let json_str = &txt[json_start + 4..];
                            if let Ok(meta) = serde_json::from_str::<serde_json::Value>(json_str) {
                                if let Some(items) = meta.get("Metadata").and_then(|m| m.as_array()) {
                                    for item in items {
                                        let data_obj = match item.get("Data") {
                                            Some(d) => d,
                                            None => continue,
                                        };
                                        let offset = data_obj.get("Offset")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(0);
                                        let duration = data_obj.get("Duration")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(0);
                                        if let Some(text_obj) = data_obj.get("text") {
                                            let word_text = text_obj.get("Text")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("")
                                                .to_string();
                                            let word_len = text_obj.get("Length")
                                                .and_then(|v| v.as_u64())
                                                .unwrap_or(word_text.len() as u64) as u32;
                                            // BoundaryType: "WordBoundary" olanlar
                                            let boundary_type = text_obj.get("BoundaryType")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("WordBoundary");
                                            if boundary_type == "WordBoundary" && !word_text.is_empty() {
                                                word_boundaries.push(WordBoundary {
                                                    audio_offset_ticks: offset,
                                                    duration_ticks: duration,
                                                    text: word_text,
                                                    text_length: word_len,
                                                    text_offset: 0, // asagida hesaplanacak
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        // Diger mesajlar (hata mesajlari dahil)
                        let preview = if txt.len() > 200 { &txt[..200] } else { &txt };
                        eprintln!("[edge-tts] Sunucu mesaji: {}", preview);
                    }
                }
                Ok(Message::Close(frame)) => {
                    let reason = frame.map(|f| format!("code={}, reason={}", f.code, f.reason))
                        .unwrap_or_else(|| "frame yok".to_string());
                    eprintln!("[edge-tts] WebSocket Close alindi: {}", reason);
                    break;
                }
                Err(e) => {
                    eprintln!("[edge-tts] WebSocket mesaj hatasi: {}", e);
                    return Err(format!("WebSocket mesaj hatasi: {}", e));
                }
                _ => {}
            }
        }
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            eprintln!("[edge-tts] Hata: {}", e);
            return Err(e);
        }
        Err(_) => {
            eprintln!("[edge-tts] 30s zaman asimi!");
            return Err("Edge TTS zaman asimi (30s)".to_string());
        }
    }

    let _ = ws.close(None).await;

    let chunk_count = audio_chunks.len();
    let total_len: usize = audio_chunks.iter().map(|c| c.len()).sum();
    let mut audio = Vec::with_capacity(total_len);
    for chunk in audio_chunks {
        audio.extend_from_slice(&chunk);
    }

    if audio.is_empty() {
        eprintln!("[edge-tts] HATA: ses verisi bos!");
        return Err("Edge TTS: ses verisi alinamadi".to_string());
    }

    // Word boundary text_offset/text_length hesapla:
    // KARAKTER bazli offset (UTF-8 byte degil!) — UIA ve JS String.slice icin gerekli
    // Orijinal metin uzerinde arar, Turkce karakterler (ş,ğ,ü,ı,ç,ö) icin dogru sonuc verir
    let mut search_from_byte: usize = 0;
    for wb in word_boundaries.iter_mut() {
        // Orijinal metinde kelimeyi ara (byte offset doner)
        let found = text[search_from_byte..].find(&wb.text)
            .map(|pos| search_from_byte + pos);
        if let Some(byte_pos) = found {
            // Byte offset -> karakter offset cevrimi
            let char_offset = text[..byte_pos].chars().count();
            let char_length = wb.text.chars().count();
            wb.text_offset = char_offset as u32;
            wb.text_length = char_length as u32;
            search_from_byte = byte_pos + wb.text.len(); // byte cinsinden ilerle
        } else {
            // Orijinalde bulunamazsa sanitize edilmiste dene
            let clean_text_local = sanitize_text(text);
            let clean_byte_start = search_from_byte.min(clean_text_local.len());
            if let Some(pos) = clean_text_local[clean_byte_start..].find(&wb.text) {
                let byte_pos = clean_byte_start + pos;
                wb.text_offset = clean_text_local[..byte_pos].chars().count() as u32;
                wb.text_length = wb.text.chars().count() as u32;
                search_from_byte = byte_pos + wb.text.len();
            } else {
                wb.text_offset = text[..search_from_byte.min(text.len())].chars().count() as u32;
                wb.text_length = wb.text.chars().count() as u32;
            }
        }
    }

    eprintln!(
        "[edge-tts] Basarili! {} chunk, toplam {} byte, {} word boundary",
        chunk_count,
        total_len,
        word_boundaries.len()
    );

    Ok((audio, word_boundaries))
}
