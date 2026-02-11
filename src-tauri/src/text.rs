pub fn process_text(
    text: &str,
    language: &str,
    turkish_corrections: bool,
    hallucination_filter: bool,
    user_corrections: Option<&std::collections::HashMap<String, String>>,
) -> String {
    process_text_full(text, language, turkish_corrections, hallucination_filter, user_corrections, true, true, true, true, false)
}

pub fn process_text_full(
    text: &str,
    language: &str,
    turkish_corrections: bool,
    hallucination_filter: bool,
    user_corrections: Option<&std::collections::HashMap<String, String>>,
    auto_punctuation: bool,
    auto_capitalization: bool,
    preserve_english_words: bool,
    auto_comma: bool,
    paragraph_break: bool,
) -> String {
    let text = text.trim().to_string();
    if text.is_empty() {
        return text;
    }

    let text = if hallucination_filter {
        let filtered = filter_hallucinations(&text);
        if filtered.is_empty() {
            return filtered;
        }
        filtered
    } else {
        text
    };

    // Rakam → yazi donusumu (Speech API "on" dediklerinde "10" yazabiliyor)
    let text = if language == "tr" {
        normalize_turkish_numbers(&text)
    } else {
        text
    };

    let text = if language == "tr" {
        fix_turkish_chars(&text)
    } else {
        text
    };

    let text = if turkish_corrections && language == "tr" {
        apply_turkish_corrections_with_flags(&text, preserve_english_words)
    } else {
        text
    };

    // Kullanici duzeltme sozlugu uygula (3+ tekrar olanlar)
    let text = if let Some(corrections) = user_corrections {
        crate::corrections::apply_user_corrections(&text, corrections)
    } else {
        text
    };

    let text = if auto_punctuation {
        add_punctuation_with_flags(&text, language, auto_comma, paragraph_break)
    } else {
        text
    };

    let text = if auto_capitalization {
        fix_capitalization(&text)
    } else {
        text
    };

    // TDK bosluk kurallari: noktalama etrafinda duzgun bosluk
    normalize_spacing(&text)
}

/// Metni isle + pipeline'in yaptigi duzeltmeleri cikart.
/// Dondurur: (islenmis_metin, ogrenilen_ciftler)
pub fn process_text_and_learn(
    text: &str,
    language: &str,
    turkish_corrections: bool,
    hallucination_filter: bool,
    user_corrections: Option<&std::collections::HashMap<String, String>>,
    auto_punctuation: bool,
    auto_capitalization: bool,
    preserve_english_words: bool,
    auto_comma: bool,
    paragraph_break: bool,
) -> (String, Vec<(String, String)>) {
    let processed = process_text_full(
        text, language, turkish_corrections, hallucination_filter,
        user_corrections, auto_punctuation, auto_capitalization,
        preserve_english_words, auto_comma, paragraph_break,
    );

    let pairs = learn_pipeline_corrections(text, &processed);
    (processed, pairs)
}

/// Pipeline oncesi ve sonrasi metni karsilastirip Levenshtein <=2 olan
/// kelime farklarini ogrenme cifti olarak dondur.
/// Kisa kelimeler (<3 karakter) ve stop-word'ler filtrelenir.
pub fn learn_pipeline_corrections(before: &str, after: &str) -> Vec<(String, String)> {
    let before_words: Vec<&str> = before.split_whitespace().collect();
    let after_words: Vec<&str> = after.split_whitespace().collect();

    let mut pairs = Vec::new();

    let strip_punct = |s: &str| -> String {
        s.trim_start_matches(|c: char| c == '.' || c == ',' || c == '!' || c == '?' || c == '"' || c == '\'')
         .trim_end_matches(|c: char| c == '.' || c == ',' || c == '!' || c == '?' || c == '"' || c == '\'')
         .to_string()
    };

    if before_words.len() == after_words.len() {
        for (b, a) in before_words.iter().zip(after_words.iter()) {
            let bl = strip_punct(&b.to_lowercase());
            let al = strip_punct(&a.to_lowercase());
            if bl.len() < 3 || al.is_empty() || bl == al {
                continue;
            }
            if crate::corrections::is_turkish_stopword(&bl) || crate::corrections::is_turkish_stopword(&al) {
                continue;
            }
            let dist = crate::corrections::levenshtein(&bl, &al);
            if dist > 0 && dist <= 2 {
                pairs.push((bl, al));
            }
        }
    } else {
        // Farkli uzunlukta: basit hizalama — kisa olan uzerinden git
        let min_len = before_words.len().min(after_words.len());
        for i in 0..min_len {
            let bl = strip_punct(&before_words[i].to_lowercase());
            let al = strip_punct(&after_words[i].to_lowercase());
            if bl.len() < 3 || al.is_empty() || bl == al {
                continue;
            }
            if crate::corrections::is_turkish_stopword(&bl) || crate::corrections::is_turkish_stopword(&al) {
                continue;
            }
            let dist = crate::corrections::levenshtein(&bl, &al);
            if dist > 0 && dist <= 2 {
                pairs.push((bl, al));
            }
        }
    }

    pairs
}

// ── Rakam → Turkce yazi donusumu ──

fn number_to_turkish(n: u32) -> Option<String> {
    let word = match n {
        0 => "sıfır",
        1 => "bir",
        2 => "iki",
        3 => "üç",
        4 => "dört",
        5 => "beş",
        6 => "altı",
        7 => "yedi",
        8 => "sekiz",
        9 => "dokuz",
        10 => "on",
        20 => "yirmi",
        30 => "otuz",
        40 => "kırk",
        50 => "elli",
        60 => "altmış",
        70 => "yetmiş",
        80 => "seksen",
        90 => "doksan",
        100 => "yüz",
        _ => {
            // Bilesik sayi: 11-99
            if n > 10 && n < 100 {
                let tens = (n / 10) * 10;
                let ones = n % 10;
                if ones == 0 {
                    return None;
                }
                let tens_w = number_to_turkish(tens)?;
                let ones_w = number_to_turkish(ones)?;
                return Some(format!("{} {}", tens_w, ones_w));
            }
            return None;
        }
    };
    Some(word.to_string())
}

/// Turkce'de yaygin birim/para birimleri - rakam bu kelimelerden once geliyorsa
/// sayi olarak kalmali (orn: "100 lira", "5 kilo")
fn is_number_unit(word: &str) -> bool {
    let units = [
        "lira", "tl", "dolar", "euro", "sterlin", "kuruş",
        "kilo", "kilogram", "kg", "gram", "gr", "ton",
        "metre", "meter", "km", "cm", "mm", "mil",
        "litre", "lt",
        "saat", "dakika", "saniye",
        "gün", "ay", "yıl", "yılında", "yılı",
        "kişi", "kez", "defa", "adet", "tane",
        "%", "derece",
        "milyon", "milyar", "bin",
    ];
    let lower = word.to_lowercase();
    units.iter().any(|u| lower == *u || lower.starts_with(u))
}

/// Speech API'nin rakam olarak yazdigi sayilari Turkce kelimelere cevir.
/// Ozellikle ek takili rakamlar: "10un" → "onun", "3te" → "üçte"
/// Kucuk tek basina sayilar (0-10): birim kelimeden once degilse kelimeye cevir
fn normalize_turkish_numbers(text: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Rakam baslangicindan bak
        if chars[i].is_ascii_digit() {
            // Rakam baslangici — kac basamak?
            let num_start = i;
            while i < len && chars[i].is_ascii_digit() {
                i += 1;
            }
            let num_str: String = chars[num_start..i].iter().collect();
            let num_val: u32 = num_str.parse().unwrap_or(u32::MAX);

            // Apostrof kontrolu: 10'un, 3'te gibi
            let has_apostrophe = i < len && (chars[i] == '\'' || chars[i] == '\u{2019}');
            if has_apostrophe {
                i += 1; // apostrof'u atla
            }

            // Sayidan sonra Turkce harf (ek) geliyor mu?
            let suffix_start = i;
            while i < len && chars[i].is_alphabetic() && !chars[i].is_ascii_digit() {
                i += 1;
            }
            let suffix: String = chars[suffix_start..i].iter().collect();

            // Ek takili rakam: kesinlikle kelimeye cevir (10un → onun)
            if !suffix.is_empty() && num_val <= 100 {
                if let Some(word) = number_to_turkish(num_val) {
                    result.push_str(&word);
                    result.push_str(&suffix);
                    continue;
                }
            }

            // Kucuk tek basina sayi (0-10): birimden once degilse kelimeye cevir
            if suffix.is_empty() && num_val <= 10 {
                // Sonraki kelime birim mi?
                let rest: String = chars[i..].iter().collect();
                let next_word = rest.trim_start().split_whitespace().next().unwrap_or("");
                if !is_number_unit(next_word) {
                    if let Some(word) = number_to_turkish(num_val) {
                        // Apostrof varsa geri koy (olmamali ama guvenlik icin)
                        if has_apostrophe {
                            result.push_str(&num_str);
                            result.push('\'');
                        } else {
                            result.push_str(&word);
                        }
                        continue;
                    }
                }
            }

            // Donusturulemedi — orijinal metni koy
            result.push_str(&num_str);
            if has_apostrophe && suffix.is_empty() {
                result.push('\'');
            } else if has_apostrophe {
                result.push('\'');
            }
            result.push_str(&suffix);
            continue;
        }

        result.push(chars[i]);
        i += 1;
    }

    result
}

// ── TDK bosluk kurallari ──

/// Noktalama isaretleri etrafinda dogru bosluk kullanimi
fn normalize_spacing(text: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();

    for i in 0..len {
        let ch = chars[i];

        // Noktalama oncesi gereksiz bosluk: " ," → ","
        if (ch == ',' || ch == '.' || ch == '!' || ch == '?' || ch == ':' || ch == ';')
            && !result.is_empty()
        {
            // Sondaki bosluklari sil
            while result.ends_with(' ') {
                result.pop();
            }
            result.push(ch);

            // Noktalamadan sonra bosluk veya satir sonu yoksa ekle
            // (ama metnin sonu degilse ve sonraki karakter rakam/harf ise)
            if i + 1 < len {
                let next = chars[i + 1];
                if next != ' ' && next != '\n' && next != '\r'
                    && next != '.' && next != '!' && next != '?'
                    && next != ',' && next != ')' && next != '"'
                    && next != '\'' && next != '\u{201D}'
                {
                    result.push(' ');
                }
            }
            continue;
        }

        // Coklu bosluk → tek bosluk (newline haric)
        if ch == ' ' && result.ends_with(' ') {
            continue;
        }

        result.push(ch);
    }

    result
}

fn fix_turkish_chars(text: &str) -> String {
    // Whisper bazen Turkce karakterleri yanlis uretebilir
    // Bilinen kisa kelime eslesmeleri: ASCII -> Turkce
    // NOT: Tehlikeli/belirsiz kisa kelimeler cikarildi:
    //   "on" (10/ön), "ol" (olmak/ölmek), "us" (belirsiz), "dis" (diş/dış cakisma)
    let mut result = text.to_string();

    let char_fixes: &[(&str, &str)] = &[
        // Kisa, net eslesmeler (cakisma riski dusuk)
        ("guc", "güç"),
        ("gul", "gül"),
        ("goz", "göz"),
        ("suc", "suç"),
        ("tum", "tüm"),
        ("uc", "üç"),
        ("ic", "iç"),
        ("soz", "söz"),
        ("yuz", "yüz"),
        ("duz", "düz"),
        ("bos", "boş"),
        ("tas", "taş"),
        ("bas", "baş"),
        ("yas", "yaş"),
        ("kis", "kış"),
        ("kus", "kuş"),
    ];

    for (wrong, correct) in char_fixes {
        // Ingilizce kelime ile cakisiyorsa atla
        if is_english_loanword(wrong) {
            continue;
        }
        result = replace_whole_word(&result, wrong, correct);
    }

    result
}

/// Turkce icinde kullanilan yaygin Ingilizce kelimeler - bunlara dokunma
fn is_english_loanword(word: &str) -> bool {
    let english_words = [
        // Teknoloji / Is dunyasi
        "meeting", "project", "deadline", "email", "mail", "feature",
        "bug", "fix", "update", "release", "deploy", "server", "client",
        "database", "cloud", "app", "software", "hardware", "network",
        "online", "offline", "laptop", "desktop", "mobile", "tablet",
        "startup", "feedback", "design", "developer", "manager", "team",
        "sprint", "scrum", "agile", "backend", "frontend", "fullstack",
        "api", "url", "link", "click", "login", "logout", "signup",
        "password", "username", "admin", "dashboard", "report", "status",
        "live", "stream", "video", "audio", "podcast", "blog", "post",
        "comment", "share", "like", "follow", "subscribe", "content",
        "marketing", "brand", "target", "budget", "plan", "strategy",
        "performance", "data", "analytics", "insight", "trend", "growth",
        "slide", "presentation", "demo", "pitch", "brief", "scope",
        "task", "issue", "ticket", "board", "workflow", "pipeline",
        "push", "pull", "merge", "commit", "branch", "repository",
        "test", "debug", "log", "error", "warning", "crash", "build",
        "run", "stop", "start", "reset", "setup", "config", "setting",
        "file", "folder", "drive", "storage", "backup", "restore",
        "install", "download", "upload", "import", "export",
        "zoom", "slack", "teams", "discord", "notion", "figma",
        "google", "microsoft", "apple", "amazon", "meta", "twitter",
        "youtube", "instagram", "whatsapp", "telegram", "linkedin",
        "react", "node", "python", "java", "rust", "docker", "linux",
        // Gunluk kullanim
        "gun", "ok", "cool", "nice", "super", "top", "best", "good",
        "great", "perfect", "awesome", "amazing", "excellent",
        "sorry", "thanks", "thank", "please", "hello", "hi", "bye",
        "yes", "no", "maybe", "sure", "right", "left",
        "black", "white", "blue", "red", "green", "pink", "gold",
        "big", "small", "fast", "slow", "new", "old", "hot", "cold",
        "time", "date", "day", "week", "month", "year",
        "shop", "store", "market", "mall", "cafe", "restaurant",
        "fitness", "gym", "spa", "yoga", "diet", "vegan",
        "style", "trend", "fashion", "look", "show", "event", "party",
        "ticket", "check", "list", "note", "pin", "tag", "label",
    ];
    let lower = word.to_lowercase();
    english_words.contains(&lower.as_str())
}

/// Turkce kelime duzeltme sozlugu - yaygin Whisper hatalarini duzelt
fn apply_turkish_corrections(text: &str) -> String {
    apply_turkish_corrections_with_flags(text, true)
}

fn apply_turkish_corrections_with_flags(text: &str, preserve_english: bool) -> String {
    let mut result = text.to_string();

    // Yaygin Whisper Turkce yanlisliklari (kelime bazli)
    let corrections = [
        // === Turkce ozel karakter eksiklikleri ===

        // Fiil kokler ve cekimler
        ("degil", "değil"),
        ("degilim", "değilim"),
        ("degilsin", "değilsin"),
        ("degiliz", "değiliz"),
        ("oyle", "öyle"),
        ("boyle", "böyle"),
        ("soyle", "söyle"),
        ("soylemek", "söylemek"),
        ("soyluyorum", "söylüyorum"),
        ("soyledi", "söyledi"),
        ("gormek", "görmek"),
        ("gordum", "gördüm"),
        ("goruyor", "görüyor"),
        ("goruyorum", "görüyorum"),
        ("gorus", "görüş"),
        ("gorusmek", "görüşmek"),
        ("gorusuruz", "görüşürüz"),
        ("gorusme", "görüşme"),
        ("dusun", "düşün"),
        ("dusunmek", "düşünmek"),
        ("dusunuyorum", "düşünüyorum"),
        ("dusundugum", "düşündüğüm"),
        ("dusunce", "düşünce"),
        ("gelmis", "gelmiş"),
        ("geliyor", "geliyor"),
        ("gelecek", "gelecek"),
        ("gidiyorum", "gidiyorum"),
        ("gitmis", "gitmiş"),
        ("gidecek", "gidecek"),
        ("yapmis", "yapmış"),
        ("yapiyorum", "yapıyorum"),
        ("yapacak", "yapacak"),
        ("etmis", "etmiş"),
        ("olmis", "olmuş"),
        ("oluyor", "oluyor"),
        ("olmus", "olmuş"),
        ("olmak", "olmak"),
        ("vermis", "vermiş"),
        ("veriyor", "veriyor"),
        ("almis", "almış"),
        ("aliyor", "alıyor"),
        ("bilmis", "bilmiş"),
        ("biliyor", "biliyor"),
        ("biliyorum", "biliyorum"),
        ("koymak", "koymak"),
        ("koymus", "koymuş"),
        ("gecmis", "geçmiş"),
        ("gecmek", "geçmek"),
        ("geciyor", "geçiyor"),
        ("baslamis", "başlamış"),
        ("baslamak", "başlamak"),
        ("basliyor", "başlıyor"),
        ("calisma", "çalışma"),
        ("calismak", "çalışmak"),
        ("calisiyorum", "çalışıyorum"),
        ("calisiyor", "çalışıyor"),
        ("calistim", "çalıştım"),
        ("ogrenmek", "öğrenmek"),
        ("ogrendim", "öğrendim"),
        ("ogreniyor", "öğreniyor"),

        // Yaygin isimler
        ("tesekkur", "teşekkür"),
        ("tesekkurler", "teşekkürler"),
        ("musteri", "müşteri"),
        ("musteriler", "müşteriler"),
        ("ogrenci", "öğrenci"),
        ("ogrenciler", "öğrenciler"),
        ("ogretmen", "öğretmen"),
        ("ogretmenler", "öğretmenler"),
        ("goruntuleme", "görüntüleme"),
        ("dunya", "dünya"),
        ("dunyanin", "dünyanın"),
        ("urun", "ürün"),
        ("urunler", "ürünler"),
        ("uretim", "üretim"),
        ("surec", "süreç"),
        ("surecler", "süreçler"),
        ("iletisim", "iletişim"),
        ("gelisim", "gelişim"),
        ("gelistirme", "geliştirme"),
        ("gelistirmek", "geliştirmek"),
        ("yonetim", "yönetim"),
        ("yonetici", "yönetici"),
        ("yoneticiler", "yöneticiler"),
        ("donus", "dönüş"),
        ("donusum", "dönüşüm"),
        ("disari", "dışarı"),
        ("icin", "için"),
        ("gercek", "gerçek"),
        ("gercekten", "gerçekten"),
        ("gerceklestirilmek", "gerçekleştirilmek"),
        ("ozur", "özür"),
        ("lutfen", "lütfen"),

        // Gunluk / yaygin isimler
        ("gunluk", "günlük"),
        ("gozluk", "gözlük"),
        ("musluk", "musluk"),
        ("universite", "üniversite"),
        ("universitelerin", "üniversitelerin"),
        ("kutuphane", "kütüphane"),
        ("hastane", "hastane"),
        ("belediye", "belediye"),
        ("kultur", "kültür"),
        ("kulturel", "kültürel"),
        ("mulk", "mülk"),
        ("mulkiyet", "mülkiyet"),

        // Sifatlar ve zarflar
        ("guzel", "güzel"),
        ("onemli", "önemli"),
        ("onemi", "önemi"),
        ("ozel", "özel"),
        ("ozgur", "özgür"),
        ("ozgurluk", "özgürlük"),
        ("guclu", "güçlü"),
        ("gucsuz", "güçsüz"),
        ("buyuk", "büyük"),
        ("buyukler", "büyükler"),
        ("kucuk", "küçük"),
        ("kucukler", "küçükler"),
        ("yuksek", "yüksek"),
        ("dusuk", "düşük"),
        ("uzun", "uzun"),
        ("mumkun", "mümkün"),
        ("mumkunse", "mümkünse"),
        ("basarili", "başarılı"),
        ("basariyla", "başarıyla"),
        ("olaganustu", "olağanüstü"),
        ("mukemmel", "mükemmel"),
        ("harika", "harika"),

        // Baglaclar / edatlar
        ("cunki", "çünkü"),
        ("cunku", "çünkü"),
        ("yuzunden", "yüzünden"),
        ("uzerine", "üzerine"),
        ("uzerinde", "üzerinde"),
        ("uzerinden", "üzerinden"),
        ("ustunde", "üstünde"),
        ("ustune", "üstüne"),
        ("dolayi", "dolayı"),
        ("dolayisiyla", "dolayısıyla"),
        ("oturu", "ötürü"),
        ("itibaren", "itibaren"),

        // Ozel isimler / cografya
        ("turkce", "Türkçe"),
        ("turkiye", "Türkiye"),
        ("istanbul", "İstanbul"),
        ("ankara", "Ankara"),
        ("izmir", "İzmir"),
        ("antalya", "Antalya"),

        // Cok sik Whisper hatalari
        ("cok", "çok"),
        ("isin", "işin"),
        ("isler", "işler"),
        ("islem", "işlem"),
        ("islemler", "işlemler"),
        ("kalca", "kalça"),
        ("sayi", "sayı"),
        ("sayilar", "sayılar"),
        ("sorun", "sorun"),
        ("sorunlar", "sorunlar"),
        ("cozum", "çözüm"),
        ("cozumler", "çözümler"),
        ("cozmek", "çözmek"),
        ("cesit", "çeşit"),
        ("cesitli", "çeşitli"),
        ("ceviri", "çeviri"),
        ("cevre", "çevre"),
        ("cevresinde", "çevresinde"),
        ("sicak", "sıcak"),
        ("soguk", "soğuk"),
        ("komsuluk", "komşuluk"),
        ("dusman", "düşman"),
    ];

    for (wrong, correct) in &corrections {
        // Ingilizce kelime ile cakisiyorsa atla
        if preserve_english && is_english_loanword(wrong) {
            continue;
        }
        result = replace_whole_word(&result, wrong, correct);
    }

    result
}

/// Unicode-aware kelime siniri kontrolu
fn is_word_char(ch: char) -> bool {
    ch.is_alphabetic() || ch == '\'' || ch == '\u{2019}'
}

/// Sadece tam kelime eslesmelerini degistir (Unicode-aware)
fn replace_whole_word(text: &str, word: &str, replacement: &str) -> String {
    let mut result = String::new();
    let text_lower = text.to_lowercase();
    let word_lower = word.to_lowercase();
    let mut last_end = 0;

    for (idx, _) in text_lower.match_indices(&word_lower) {
        // Unicode-aware kelime siniri kontrolu
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
            // Eslesen kelimeyi cikar, Ingilizce kelimeyse atla
            let matched = &text[idx..after_idx];
            if is_english_loanword(matched) {
                continue;
            }

            result.push_str(&text[last_end..idx]);
            // Orijinal metindeki buyuk/kucuk harf durumunu koru
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

/// Noktalama isaretleri ekle
fn add_punctuation(text: &str, language: &str) -> String {
    add_punctuation_with_flags(text, language, true, false)
}

fn add_punctuation_with_flags(text: &str, language: &str, auto_comma: bool, paragraph_break: bool) -> String {
    if text.is_empty() {
        return text.to_string();
    }

    let sentences = split_into_sentences(text);
    let mut result_parts: Vec<String> = Vec::new();

    for sentence in &sentences {
        let trimmed = sentence.trim();
        if trimmed.is_empty() {
            continue;
        }

        let processed = match language {
            "tr" => punctuate_turkish_with_flags(trimmed, auto_comma),
            "en" => punctuate_english_with_flags(trimmed, auto_comma),
            _ => ensure_ending_punctuation(trimmed),
        };
        result_parts.push(processed);
    }

    let joiner = if paragraph_break { "\n" } else { " " };
    result_parts.join(joiner)
}

/// Metni cumlelere ayir - mevcut noktalama isaretlerini koruyarak
/// Uzun noktalamasiz parcalar icin heuristik bolme uygular
fn split_into_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        current.push(ch);
        if ch == '.' || ch == '!' || ch == '?' {
            sentences.push(current.clone());
            current.clear();
        }
    }

    if !current.trim().is_empty() {
        // Noktalamasiz son parca: eger 15+ kelimeyse heuristik bolme dene
        let words: Vec<&str> = current.trim().split_whitespace().collect();
        if words.len() >= 15 {
            let mut sub_sentences = heuristic_split_long_text(&current);
            sentences.append(&mut sub_sentences);
        } else {
            sentences.push(current);
        }
    }

    sentences
}

/// Uzun noktalamasiz metin parcalarini baglac bazli bol
fn heuristic_split_long_text(text: &str) -> Vec<String> {
    let split_markers = [
        " ve ", " sonra ", " ardından ", " daha sonra ",
        " ondan sonra ", " bundan sonra ", " ayrıca ",
        " ancak ", " fakat ", " ama ",
    ];

    let mut parts: Vec<String> = Vec::new();
    let mut remaining = text.to_string();

    for marker in &split_markers {
        let lower = remaining.to_lowercase();
        if let Some(pos) = lower.find(marker) {
            // Marker'dan sonra en az 3 kelime olmali
            let after = &remaining[pos + marker.len()..];
            let after_words: Vec<&str> = after.trim().split_whitespace().collect();
            if after_words.len() >= 3 {
                let before = remaining[..pos].trim().to_string();
                if !before.is_empty() {
                    parts.push(before);
                }
                // Marker'i sonraki parcaya ekle (basa koy)
                remaining = remaining[pos..].to_string();
            }
        }
    }

    if !remaining.trim().is_empty() {
        parts.push(remaining.trim().to_string());
    }

    // Eger sadece 1 parca cikmissa bolme basarisiz — orijinal metni dondur
    if parts.len() <= 1 {
        return vec![text.to_string()];
    }

    parts
}

fn punctuate_turkish(sentence: &str) -> String {
    punctuate_turkish_with_flags(sentence, true)
}

fn punctuate_turkish_with_flags(sentence: &str, auto_comma: bool) -> String {
    let trimmed = sentence.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let maybe_commas = |s: &str| -> String {
        if auto_comma { add_turkish_commas(s) } else { s.to_string() }
    };

    // Zaten noktalamasi varsa dokunma
    if ends_with_punctuation(trimmed) {
        return maybe_commas(trimmed);
    }

    let lower = trimmed.to_lowercase();
    let words: Vec<&str> = lower.split_whitespace().collect();

    // Soru eki kontrolu
    let question_suffixes = [
        "mi", "mı", "mu", "mü",
        "mısın", "misin", "musun", "müsün",
        "miyiz", "mıyız", "muyuz", "müyüz",
        "mısınız", "misiniz", "musunuz", "müsünüz",
        "mudur", "müdür", "midir", "mıdır",
        // Bilesik soru ekleri
        "değilmi", "değilmı", "olurmu", "olmuzmu",
        "edermi", "yaparmi", "gelirmi", "gidermi",
    ];

    if let Some(last_word) = words.last() {
        for suffix in &question_suffixes {
            if *last_word == *suffix {
                let result = format!("{}?", trimmed);
                return maybe_commas(&result);
            }
        }
    }

    // Soru sozcugu kontrolu
    let question_words = [
        "ne", "neden", "nasıl", "nereye", "nerede", "nereden",
        "kim", "kime", "kimi", "kimin",
        "niçin", "niye", "hangi", "kaç",
        // Yeni soru kelimeleri
        "acaba", "yoksa", "hani", "peki",
    ];

    if let Some(first_word) = words.first() {
        for qw in &question_words {
            if *first_word == *qw {
                let result = format!("{}?", trimmed);
                return maybe_commas(&result);
            }
        }
    }

    // Unlem kontrolu
    let exclamation_words = [
        "eyvah", "aman", "haydi", "bravo", "maşallah",
        "vay", "yuh", "hadi", "aferin",
        // Yeni unlem kelimeleri
        "ay", "of", "oha", "aaa", "tüh", "yaşa", "helal",
        "harika", "muhteşem", "süper", "mükemmel", "allah",
        "evet", "tabii", "kesinlikle", "olsun",
    ];

    if let Some(first_word) = words.first() {
        for ew in &exclamation_words {
            if *first_word == *ew {
                let result = format!("{}!", trimmed);
                return maybe_commas(&result);
            }
        }
    }

    // Varsayilan: nokta ekle
    let result = format!("{}.", trimmed);
    maybe_commas(&result)
}

fn add_turkish_commas(text: &str) -> String {
    let comma_words = [
        "ama", "fakat", "ancak", "çünkü", "yani", "ayrıca",
        "örneğin", "mesela", "dolayısıyla", "üstelik", "halbuki",
        // Yeni baglaclar
        "oysa", "oysaki", "lakin", "nitekim", "zira",
        "dahası",
    ];

    let mut result = text.to_string();
    for word in &comma_words {
        result = insert_comma_before_word(&result, word);
    }

    // Cok kelimelik baglaclar
    let multi_word_connectors = [
        "bununla birlikte", "ne var ki", "öte yandan",
        "buna rağmen", "bunun yanında",
    ];
    for phrase in &multi_word_connectors {
        result = insert_comma_before_phrase(&result, phrase);
    }

    result
}

fn punctuate_english(sentence: &str) -> String {
    punctuate_english_with_flags(sentence, true)
}

fn punctuate_english_with_flags(sentence: &str, auto_comma: bool) -> String {
    let trimmed = sentence.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let maybe_commas = |s: &str| -> String {
        if auto_comma { add_english_commas(s) } else { s.to_string() }
    };

    // Zaten noktalamasi varsa dokunma
    if ends_with_punctuation(trimmed) {
        return maybe_commas(trimmed);
    }

    let lower = trimmed.to_lowercase();
    let words: Vec<&str> = lower.split_whitespace().collect();

    // Soru kontrolu
    let question_starters = [
        "what", "where", "when", "why", "how", "who", "which",
        "do", "does", "did", "is", "are", "can", "could",
        "would", "will", "shall",
    ];

    if let Some(first_word) = words.first() {
        for qs in &question_starters {
            if *first_word == *qs {
                let result = format!("{}?", trimmed);
                return maybe_commas(&result);
            }
        }
    }

    // Varsayilan: nokta ekle
    let result = format!("{}.", trimmed);
    maybe_commas(&result)
}

fn add_english_commas(text: &str) -> String {
    let comma_words = [
        "but", "however", "although", "because", "therefore",
        "moreover", "furthermore",
    ];

    let mut result = text.to_string();
    for word in &comma_words {
        result = insert_comma_before_word(&result, word);
    }
    result
}

/// Belirtilen kelimenin oncesine virgul ekle (eger henuz yoksa)
fn insert_comma_before_word(text: &str, word: &str) -> String {
    let mut result = String::new();
    let text_lower = text.to_lowercase();
    let search = format!(" {}", word);
    let mut last_end = 0;

    for (idx, _) in text_lower.match_indices(&search) {
        // Kelime siniri kontrolu: search'den sonraki karakter bosluk veya noktalama olmali
        let after_idx = idx + search.len();
        let after_ok = after_idx >= text.len()
            || text.as_bytes().get(after_idx).map_or(true, |b| {
                *b == b' ' || *b == b',' || *b == b'.' || *b == b'?' || *b == b'!'
            });

        if !after_ok {
            continue;
        }

        // Oncesinde zaten virgul var mi?
        let before = text[last_end..idx].trim_end();
        if before.ends_with(',') {
            // Zaten virgul var, degistirme
            result.push_str(&text[last_end..after_idx]);
            last_end = after_idx;
            continue;
        }

        result.push_str(&text[last_end..idx]);
        result.push(',');
        result.push_str(&text[idx..after_idx]);
        last_end = after_idx;
    }

    result.push_str(&text[last_end..]);
    result
}

/// Cok kelimelik ifadelerin oncesine virgul ekle
fn insert_comma_before_phrase(text: &str, phrase: &str) -> String {
    let text_lower = text.to_lowercase();
    let search = format!(" {}", phrase);

    if let Some(idx) = text_lower.find(&search) {
        // Oncesinde zaten virgul var mi?
        let before = text[..idx].trim_end();
        if before.ends_with(',') {
            return text.to_string();
        }
        let mut result = String::new();
        result.push_str(&text[..idx]);
        result.push(',');
        result.push_str(&text[idx..]);
        return result;
    }

    text.to_string()
}

fn ends_with_punctuation(text: &str) -> bool {
    text.ends_with('.') || text.ends_with('!') || text.ends_with('?')
}

fn ensure_ending_punctuation(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() || ends_with_punctuation(trimmed) {
        return trimmed.to_string();
    }
    format!("{}.", trimmed)
}

fn fix_capitalization(text: &str) -> String {
    if text.is_empty() {
        return text.to_string();
    }

    let mut result = String::new();
    let mut capitalize_next = true;

    for ch in text.chars() {
        if capitalize_next && ch.is_alphabetic() {
            // Turkce buyuk harf donusumu
            let upper = match ch {
                'i' => 'İ',
                _ => ch.to_uppercase().next().unwrap_or(ch),
            };
            result.push(upper);
            capitalize_next = false;
        } else {
            result.push(ch);
            if ch == '.' || ch == '!' || ch == '?' || ch == '\n' {
                capitalize_next = true;
            }
        }
    }

    result
}

fn filter_hallucinations(text: &str) -> String {
    let trimmed = text.trim();

    // Bos veya cok kisa metin
    if trimmed.is_empty() || trimmed.len() < 2 {
        return String::new();
    }

    // Bilinen halusinasyon kaliplari
    let hallucination_patterns = [
        "Altyazı",
        "altyazı",
        "Abone ol",
        "abone ol",
        "Beğen",
        "beğen",
        "Subscribe",
        "Thank you",
        "thanks for watching",
        "Thanks for watching",
        "[Müzik]",
        "[müzik]",
        "(Müzik)",
        "...",
        "Altyazı M.K.",
        "AÇIK CEZAEVİ",
        "www.",
        "http",
        "Devamını izle",
        "Bir sonraki",
        "Videoyu beğen",
        "SESLİ",
        "Sessiz",
        "ABONE",
        "Amara.org",
        "subtitles",
        "Subtitles",
    ];

    let lower = trimmed.to_lowercase();
    for pattern in &hallucination_patterns {
        let pattern_lower = pattern.to_lowercase();
        if lower == pattern_lower
            || (lower.starts_with(&pattern_lower) && trimmed.len() < pattern.len() + 10)
        {
            log::info!("Halusinasyon filtrelendi: {}", trimmed);
            return String::new();
        }
    }

    // Tekrarlanan kelime/hece tespiti
    if detect_repetition(trimmed) {
        log::info!("Tekrar halusinasyonu filtrelendi: {}", trimmed);
        return String::new();
    }

    // Tekrarlanan karakter/sayi kaliplari tespiti
    if detect_char_repetition(trimmed) {
        log::info!("Karakter tekrar halusinasyonu filtrelendi: {}", trimmed);
        return String::new();
    }

    // Sadece noktalama veya ozel karakterlerden olusan metin
    let alpha_count = trimmed.chars().filter(|c| c.is_alphabetic()).count();
    if alpha_count < 2 {
        return String::new();
    }

    // Cok fazla ayni karakter iceren metin
    if has_excessive_char_repeat(trimmed) {
        log::info!("Asiri karakter tekrari filtrelendi: {}", trimmed);
        return String::new();
    }

    trimmed.to_string()
}

/// Tekrarlanan karakter/sayi kaliplarini tespit et
fn detect_char_repetition(text: &str) -> bool {
    let clean: String = text
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect();
    let clean = clean.trim();

    if clean.len() < 4 {
        return false;
    }

    let mut char_counts = std::collections::HashMap::new();
    for ch in clean.chars() {
        if !ch.is_whitespace() {
            *char_counts.entry(ch).or_insert(0usize) += 1;
        }
    }

    let total_chars: usize = char_counts.values().sum();
    if total_chars == 0 {
        return false;
    }

    for (_ch, count) in &char_counts {
        if *count as f32 / total_chars as f32 > 0.6 && *count > 4 {
            return true;
        }
    }

    false
}

/// Asiri tekrarlanan ayni karakter kontrolu
fn has_excessive_char_repeat(text: &str) -> bool {
    let mut consecutive = 1;
    let mut prev = None;
    for ch in text.chars() {
        if ch.is_whitespace() || ch == '-' || ch == ',' {
            continue;
        }
        if Some(ch) == prev {
            consecutive += 1;
            if consecutive >= 5 {
                return true;
            }
        } else {
            consecutive = 1;
        }
        prev = Some(ch);
    }
    false
}

fn detect_repetition(text: &str) -> bool {
    let words: Vec<&str> = text.split_whitespace().collect();

    if words.len() < 4 {
        return false;
    }

    // Tum metin ayni kelimenin tekrarindan mi olusuyor?
    let unique_words: std::collections::HashSet<String> = words.iter().map(|w| w.to_lowercase()).collect();

    // Eger benzersiz kelime sayisi toplam kelime sayisinin %20'sinden azsa
    // VE toplam kelime sayisi 6'dan fazlaysa -> halusinasyon
    if unique_words.len() <= 2 && words.len() >= 6 {
        return true;
    }

    // 2-3 kelimelik kaliplarin tekrari - sadece metnin tamami tekrardan olusuyorsa
    for pattern_len in 1..=3 {
        if words.len() >= pattern_len * 4 {
            let pattern: Vec<&str> = words[..pattern_len].to_vec();
            let mut matches = 0;
            let total_chunks = words.chunks(pattern_len).count();
            for chunk in words.chunks(pattern_len) {
                if chunk.len() == pattern_len {
                    let chunk_lower: Vec<String> =
                        chunk.iter().map(|w| w.to_lowercase()).collect();
                    let pattern_lower: Vec<String> =
                        pattern.iter().map(|w| w.to_lowercase()).collect();
                    if chunk_lower == pattern_lower {
                        matches += 1;
                    }
                }
            }
            // Metnin %80'inden fazlasi ayni kaliptan olusuyorsa
            if total_chunks > 0 && matches as f32 / total_chunks as f32 > 0.8 && matches >= 4 {
                return true;
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_hallucinations() {
        assert_eq!(filter_hallucinations("Altyazı"), "");
        assert_eq!(filter_hallucinations("..."), "");
        assert_eq!(filter_hallucinations("Merhaba"), "Merhaba");
    }

    #[test]
    fn test_detect_repetition() {
        assert!(detect_repetition("alo alo alo alo"));
        assert!(detect_repetition("bir iki bir iki bir iki"));
        assert!(!detect_repetition("bugün hava çok güzel"));
    }

    #[test]
    fn test_detect_char_repetition() {
        assert!(detect_char_repetition("3-3-3-3-3-3-3-3"));
        assert!(detect_char_repetition("1 2 3 3 3 3 3 3 3 3"));
        assert!(!detect_char_repetition("Merhaba dünya"));
        assert!(!detect_char_repetition("123 test"));
    }

    #[test]
    fn test_has_excessive_char_repeat() {
        assert!(has_excessive_char_repeat("aaaaaaa"));
        assert!(has_excessive_char_repeat("33333"));
        assert!(!has_excessive_char_repeat("Merhaba"));
        assert!(!has_excessive_char_repeat("aaab"));
    }

    #[test]
    fn test_fix_capitalization() {
        assert_eq!(fix_capitalization("merhaba"), "Merhaba");
        assert_eq!(fix_capitalization("iyi günler"), "İyi günler");
    }

    #[test]
    fn test_turkish_corrections() {
        assert_eq!(apply_turkish_corrections("cok guzel"), "çok güzel");
        assert_eq!(apply_turkish_corrections("degil"), "değil");
    }

    #[test]
    fn test_turkish_corrections_extended() {
        assert_eq!(apply_turkish_corrections("onemli bir surec"), "önemli bir süreç");
        assert_eq!(apply_turkish_corrections("mumkun degilim"), "mümkün değilim");
        assert_eq!(apply_turkish_corrections("universite ogrenci"), "üniversite öğrenci");
        assert_eq!(apply_turkish_corrections("cunki cok buyuk"), "çünkü çok büyük");
    }

    #[test]
    fn test_fix_turkish_chars() {
        let result = fix_turkish_chars("bu gul cok guzel");
        assert!(result.contains("gül"), "gul -> gül olmali: {}", result);
    }

    #[test]
    fn test_fix_turkish_chars_no_dangerous() {
        // "on" artik "ön"e cevrilmemeli (cok belirsiz)
        let result = fix_turkish_chars("on kisi geldi");
        assert!(result.contains("on"), "on kelimesi korunmali: {}", result);
        // "ol" artik "öl"e cevrilmemeli
        let result2 = fix_turkish_chars("iyi ol");
        assert!(result2.contains("ol"), "ol kelimesi korunmali: {}", result2);
    }

    #[test]
    fn test_turkish_question_suffix() {
        let result = process_text("bu nasil bir sey mi", "tr", true, false, None);
        assert!(result.ends_with('?'), "Soru eki ile bitmeli: {}", result);
    }

    #[test]
    fn test_turkish_question_word() {
        let result = process_text("neden boyle oldu", "tr", true, false, None);
        assert!(result.ends_with('?'), "Soru kelimesi ile bitmeli: {}", result);
    }

    #[test]
    fn test_turkish_question_acaba() {
        let result = process_text("acaba bu dogru mu", "tr", false, false, None);
        assert!(result.ends_with('?'), "acaba ile baslamali, soru olmali: {}", result);
    }

    #[test]
    fn test_turkish_comma() {
        let result = process_text("evet ama ben istemiyorum", "tr", false, false, None);
        assert!(result.contains(", ama") || result.contains(",ama"), "Virgul olmali: {}", result);
    }

    #[test]
    fn test_turkish_comma_extended() {
        let result = process_text("gidecektim lakin vazgectim", "tr", false, false, None);
        assert!(result.contains(", lakin") || result.contains(",lakin"), "lakin oncesi virgul olmali: {}", result);
    }

    #[test]
    fn test_turkish_exclamation() {
        let result = process_text("bravo harika olmus", "tr", false, false, None);
        assert!(result.ends_with('!'), "Unlem ile bitmeli: {}", result);
    }

    #[test]
    fn test_turkish_exclamation_extended() {
        let result = process_text("süper bu cok iyi", "tr", false, false, None);
        assert!(result.ends_with('!'), "super ile baslamali, unlem olmali: {}", result);
    }

    #[test]
    fn test_english_question() {
        let result = process_text("how are you doing", "en", false, false, None);
        assert!(result.ends_with('?'), "Soru ile bitmeli: {}", result);
    }

    #[test]
    fn test_english_comma() {
        let result = process_text("I like it but I'm not sure", "en", false, false, None);
        assert!(result.contains(", but") || result.contains(",but"), "Virgul olmali: {}", result);
    }

    #[test]
    fn test_default_period() {
        let result = process_text("bugun hava guzel", "tr", false, false, None);
        assert!(result.ends_with('.'), "Nokta ile bitmeli: {}", result);
    }

    #[test]
    fn test_existing_punctuation_preserved() {
        let result = process_text("Merhaba!", "tr", false, false, None);
        assert_eq!(result, "Merhaba!");
    }

    #[test]
    fn test_english_loanword_preserved() {
        // "gun" Ingilizce kelime olarak korunmali, "gün"e cevrilmemeli
        assert!(is_english_loanword("gun"));
        assert!(is_english_loanword("Meeting"));
        assert!(is_english_loanword("project"));
        assert!(!is_english_loanword("degil"));
    }

    #[test]
    fn test_turkish_corrections_skip_english() {
        // "gun" kelimesi artik "gün"e cevrilmemeli
        let result = apply_turkish_corrections("gun control");
        assert_eq!(result, "gun control");
    }

    #[test]
    fn test_unicode_word_boundary() {
        // Turkce karakter sonrasi kelime siniri dogru calismali
        let result = replace_whole_word("çok güzel", "ok", "tamam");
        // "ok" kelimesi "çok" icinde olmamali (ç kelime karakteri)
        assert_eq!(result, "çok güzel");
    }

    #[test]
    fn test_paragraph_break() {
        let result = process_text_full(
            "merhaba dunya. nasilsin",
            "tr", false, false, None,
            true, true, true, true, true,
        );
        assert!(result.contains('\n'), "Paragraf modu satir sonu icermeli: {}", result);
    }

    #[test]
    fn test_heuristic_split() {
        // 15+ kelimelik noktalamasiz metin baglac bazli bolunmeli
        let long_text = "ben bugün markete gittim ve oradan bir sürü şey aldım sonra eve döndüm ve yemek yaptım";
        let sentences = split_into_sentences(long_text);
        assert!(sentences.len() > 1, "Uzun metin bolunmeli, {} parca bulundu", sentences.len());
    }

    #[test]
    fn test_full_pipeline() {
        // Tam pipeline testi: "cok guzel bir gun" -> "Çok güzel bir gün."
        let result = process_text("cok guzel bir gun", "tr", true, false, None);
        assert!(result.contains("çok") || result.contains("Çok"), "cok -> çok olmali: {}", result);
        assert!(result.contains("güzel"), "guzel -> güzel olmali: {}", result);
        assert!(result.ends_with('.'), "Nokta ile bitmeli: {}", result);
    }

    #[test]
    fn test_capitalization_after_newline() {
        let result = fix_capitalization("merhaba.\niyi günler");
        assert!(result.contains("\nİyi"), "Satir sonu sonrasi buyuk harf olmali: {}", result);
    }

    // ── Rakam → yazi testleri ──

    #[test]
    fn test_number_to_turkish_basic() {
        assert_eq!(number_to_turkish(0), Some("sıfır".to_string()));
        assert_eq!(number_to_turkish(1), Some("bir".to_string()));
        assert_eq!(number_to_turkish(10), Some("on".to_string()));
        assert_eq!(number_to_turkish(15), Some("on beş".to_string()));
        assert_eq!(number_to_turkish(23), Some("yirmi üç".to_string()));
        assert_eq!(number_to_turkish(100), Some("yüz".to_string()));
        assert_eq!(number_to_turkish(999), None);
    }

    #[test]
    fn test_normalize_numbers_suffix() {
        // Ek takili rakamlar kelimeye cevrilmeli
        assert_eq!(normalize_turkish_numbers("10un üstünde"), "onun üstünde");
        assert_eq!(normalize_turkish_numbers("3te kaldım"), "üçte kaldım");
        assert_eq!(normalize_turkish_numbers("5ten fazla"), "beşten fazla");
        assert_eq!(normalize_turkish_numbers("10'un üstünde"), "onun üstünde");
    }

    #[test]
    fn test_normalize_numbers_standalone() {
        // Kucuk tek basina sayilar kelimeye cevrilmeli
        assert_eq!(normalize_turkish_numbers("ben 10 yazdım"), "ben on yazdım");
        assert_eq!(normalize_turkish_numbers("bu 3 güzel"), "bu üç güzel");
    }

    #[test]
    fn test_normalize_numbers_keep_with_units() {
        // Birim oncesi sayilar rakam olarak kalmali
        assert_eq!(normalize_turkish_numbers("100 lira"), "100 lira");
        assert_eq!(normalize_turkish_numbers("5 kilo"), "5 kilo");
        assert_eq!(normalize_turkish_numbers("2024 yılında"), "2024 yılında");
    }

    #[test]
    fn test_normalize_numbers_large_keep() {
        // Buyuk sayilar (11+) tek basina rakam olarak kalmali
        assert_eq!(normalize_turkish_numbers("150 kişi"), "150 kişi");
    }

    // ── TDK bosluk testleri ──

    #[test]
    fn test_normalize_spacing_comma() {
        assert_eq!(normalize_spacing("merhaba , dünya"), "merhaba, dünya");
        assert_eq!(normalize_spacing("git,gel"), "git, gel");
    }

    #[test]
    fn test_normalize_spacing_period() {
        assert_eq!(normalize_spacing("bitti .yeni"), "bitti. yeni");
        assert_eq!(normalize_spacing("merhaba  dünya"), "merhaba dünya");
    }

    #[test]
    fn test_normalize_spacing_newline_preserved() {
        assert_eq!(normalize_spacing("satır bir.\nsatır iki"), "satır bir.\nsatır iki");
    }

    // ── Entegre pipeline testi ──

    #[test]
    fn test_pipeline_number_conversion() {
        // "10un üstünde" → "Onun üstünde." seklinde islenmeli
        let result = process_text("10un üstünde konuştuk", "tr", false, false, None);
        assert!(result.contains("onun") || result.contains("Onun"),
            "10un -> onun olmali: {}", result);
    }
}
