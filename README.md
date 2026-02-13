# Fisilti

Turkce odakli, gizlilik dostu ses-yazi donusturucu ve metin seslendirici. Whisper AI, Web Speech, Deepgram, Azure ve Google Cloud motorlari ile sesinizi metne cevirir; Edge TTS ile metinleri dogal seslerle okur.

## Hizli Indirme (Windows)

**[Fisilti v2.0.0 Indir (Windows 64-bit)](https://github.com/ustaz34/fisilti/releases/latest/download/Fisilti_2.0.0_x64-setup.exe)**

Indir → Cift tikla → Kur → Kullan. Hepsi bu.

> Ilk acilista Ayarlar > Model sekmesinden bir Whisper modeli indirmeniz veya Bulut Motorlari sekmesinden bir bulut motoru secmeniz gerekir.

## Ozellikler

### Ses-Yazi Donusum (STT)
- **Cevrimdisi donusum**: Whisper.cpp modelleri bilgisayarda calisir, ses verisi hicbir yere gonderilmez
- **Canli donusum**: Web Speech API ile gercek zamanli konusmadan metne
- **Bulut motorlari**: Deepgram Nova-3, Azure Speech, Google Cloud Speech destegi
- **Turkce optimizasyonu**: Turkce karakter duzeltme, noktalama, cumle algilama
- **Ogrenme sistemi**: Duzeltmeleri ogrenip zamanla daha iyi sonuclar verir
- **Dinamik prompt**: Kullanim alaniniza gore (teknik, tibbi, hukuki vb.) Whisper'a baglam verir

### Metin Seslendirme (TTS)
- **Edge TTS**: Microsoft Edge TTS motoruyla dogal sesli metin okuma
- **Turkce sesler**: Turkce erkek ve kadin sesleri dahil 400+ ses
- **Global kisayol**: Herhangi bir uygulamada secili metni tek tusla seslendir
- **Hiz/perde/ses ayari**: Okuma hizini, perdesini ve ses seviyesini ayarla
- **Oynatma kontrolleri**: Baslat, duraklat, devam et, durdur

### Genel
- **Overlay bar**: Her uygulamanin ustunde gorunen kayit/seslendirme cubugu
- **Panoya kopyalama**: Donusen metni otomatik panoya kopyalar
- **Dogrudan yazma**: Sonucu aktif uygulamaya otomatik yazar
- **Global kisayollar**: Tek tus (F5, CapsLock vb.) veya kombinasyon (Ctrl+Shift+Space) destegi
- **Gecmis**: Onceki donusumleri goruntule ve duzenle
- **Model secimi**: Small'dan Large V3 Turbo'ya kadar farkli Whisper modelleri
- **Renk temaları**: Overlay ve arayuz renklerini ozellestirme
- **Sistem tepsisi**: Arka planda calisir, tray ikonundan erisim
- **Ses ozelestirme**: Dalga stilleri ve overlay gorunum varyantlari

## Ekran Goruntuleri

| Ana Pencere | Overlay Bar |
|:-----------:|:-----------:|
| Ayarlar, model yonetimi, gecmis ve daha fazlasi | Ekranin altinda kayit/seslendirme durumu |

## Kurulum (Kaynak Koddan Derleme)

### On Kosullar

1. **Node.js** (v18+): https://nodejs.org
2. **Rust** (stable): https://rustup.rs
3. **Visual Studio Build Tools** (Windows icin C++ derleyici):
   - https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - "C++ ile masaustu gelistirme" is yukunu secin
4. **LLVM/Clang** (whisper-rs icin gerekli):
   - https://releases.llvm.org/ adresinden indirin veya:
   ```
   winget install LLVM.LLVM
   ```
   - `LIBCLANG_PATH` ortam degiskenini ayarlayin:
   ```
   set LIBCLANG_PATH=C:\Program Files\LLVM\bin
   ```

### Adimlar

```bash
# 1. Repoyu klonla
git clone https://github.com/ustaz34/fisilti.git
cd fisilti

# 2. npm bagimliklarini yukle
npm install

# 3. Gelistirme modunda calistir
npm run tauri dev

# 4. (Opsiyonel) Release build olustur
npm run tauri build
```

Release build ciktisi `src-tauri/target/release/bundle/nsis/` altinda `.exe` installer olarak olusur.

### Whisper Modeli Indirme

Uygulama ilk acildiginda bir Whisper modeli indirmeniz gerekir:

1. Uygulamayi acin
2. Ayarlar panelinden "Modeller" sekmesine gidin
3. Bir model secip "Indir" butonuna basin:
   - **Small** (488 MB) — Hizli, test icin uygun
   - **Large V3 Turbo Q5** (574 MB) — Cok iyi kalite, hizli (onerilen)
   - **Large V3 Turbo** (1.5 GB) — En iyi kalite
4. Indirme tamamlaninca modeli secin ve kullanmaya baslayin

> Alternatif olarak Bulut Motorlari sekmesinden Deepgram, Azure veya Google Cloud secebilirsiniz (API anahtari gerektirir).

## Kullanim

### Ses-Yazi Donusum

1. **Kayit baslat**: Kisayol tusuna basin (varsayilan: `Ctrl+Shift+Space`) veya overlay bardaki mikrofon ikonuna tiklayin
2. **Konusun**: Turkce veya sectiginiz dilde konusun
3. **Kayit durdur**: Ayni kisayolu tekrar basin
4. **Sonuc**: Metin otomatik islenir ve panoya kopyalanir, istediginiz yere yapistiriniz

### Metin Seslendirme

1. **Seslendir sekmesi**: Metin yazip Play butonuyla okutin
2. **Global kisayol**: Herhangi bir uygulamada metni secip kisayol tusuna basin (varsayilan: `Ctrl+Shift+R`) — secili metin otomatik seslendirilir
3. **Tray menu**: Sistem tepsisinden "Panodaki Metni Oku" secenegi

### Overlay Bar

Ekranin altinda gorunen kucuk cubuk kayit ve seslendirme durumunu gosterir:
- Mavi dalga: Kayit devam ediyor
- Turuncu: Donusum yapiliyor
- Hoparlor animasyonu: Metin seslendiriliyor
- Imlecinizi takip eder

### Ogrenme Sistemi

Fisilti kullandikca ogrenmeye devam eder:
- **Otomatik ogrenme**: Pipeline'in yaptigi Turkce karakter duzeltmelerini ogrenir
- **Manuel duzeltme**: Gecmis sekmesinde bir donusumu duzenlerseniz, fark otomatik ogrenilir
- **Sozluk**: Ogrenme panelinden ogrenilen duzeltmeleri gorup yonetebilirsiniz

### Klavye Kisayollari

| Kisayol | Islem |
|---------|-------|
| `Ctrl+Shift+Space` | Kaydi baslat / durdur (ayarlanabilir) |
| `Ctrl+Shift+R` | Secili metni seslendir (ayarlanabilir) |
| `Ctrl+Shift+S` | Ayarlar penceresini ac |
| `Esc` | Kaydi iptal et |

> Kisayollar Genel Ayarlar ve Seslendir sekmelerinden degistirilebilir. Tek tus (F5, F6, CapsLock vb.) veya kombinasyon (Ctrl+Alt+R vb.) atanabilir.

## Proje Yapisi

```
fisilti/
├── src/                    # React frontend
│   ├── components/         # UI bilesenleri
│   │   ├── OverlayBar.tsx     # Overlay kayit/TTS cubugu
│   │   ├── SettingsApp.tsx    # Ana ayarlar penceresi
│   │   ├── SettingsPanel.tsx  # Genel ayarlar paneli
│   │   ├── TTSPanel.tsx       # Metin seslendirme paneli
│   │   ├── CloudEnginesPanel  # Bulut motoru ayarlari
│   │   ├── HistoryPanel.tsx   # Gecmis paneli
│   │   ├── LearningPanel.tsx  # Ogrenme paneli
│   │   ├── ModelManager.tsx   # Model yonetimi
│   │   ├── ColorsPanel.tsx    # Renk ozellestirme
│   │   └── ...
│   ├── lib/                # Servisler ve yardimcilar
│   │   ├── ttsService.ts      # TTS servis katmani
│   │   ├── edgeTTSService.ts  # Edge TTS entegrasyonu
│   │   ├── webSpeechService   # Web Speech API
│   │   └── wakeWordListener   # Sesli uyandirma
│   ├── stores/             # Zustand state yonetimi
│   │   ├── settingsStore.ts
│   │   ├── ttsStore.ts
│   │   └── ...
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/              # Rust backend (Tauri)
│   ├── src/
│   │   ├── lib.rs             # Uygulama giris noktasi
│   │   ├── keyboard_hook.rs   # Global klavye hook (Windows)
│   │   ├── edge_tts.rs        # Edge TTS WebSocket istemcisi
│   │   ├── audio.rs           # Ses yakalama (cpal)
│   │   ├── transcription.rs   # Whisper donusum
│   │   ├── text.rs            # Metin isleme pipeline
│   │   ├── corrections.rs     # Ogrenme sistemi + sozluk
│   │   ├── model.rs           # Whisper model yonetimi
│   │   ├── settings.rs        # Uygulama ayarlari
│   │   └── commands/          # Tauri komut handlerlari
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
└── vite.config.ts
```

## Teknolojiler

- **Tauri 2** — Hafif masaustu uygulama framework'u
- **React 19 + TypeScript** — Frontend
- **Rust** — Backend
- **Whisper.cpp** (whisper-rs) — Yerel ses tanima
- **Edge TTS** — Microsoft dogal ses seslendirme
- **Web Speech API** — Canli ses tanima
- **Deepgram / Azure / Google Cloud** — Bulut ses tanima motorlari
- **Windows UI Automation** — Secili metin yakalama
- **Tailwind CSS 4** — Stil
- **Zustand** — State yonetimi
- **cpal** — Ses yakalama
- **enigo** — Klavye simulasyonu

## Lisans

MIT License — Detaylar icin [LICENSE](LICENSE) dosyasina bakin.
