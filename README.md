# Fisilti

Turkce odakli, yerel calisan, gizlilik dostu ses-yazi donusturucu. Whisper AI modelini bilgisayarinda calistirarak sesinizi metne cevirir — internet veya bulut servisi gerektirmez.

## Ozellikler

- **Tamamen yerel**: Whisper.cpp modelleri bilgisayarda calisir, ses verisi hicbir yere gonderilmez
- **Turkce optimizasyonu**: Turkce karakter duzeltme, noktalama, cumle algilama
- **Ogrenme sistemi**: Duzeltmeleri ogrenip zamanla daha iyi sonuclar verir
- **Overlay bar**: Her uygulamanin ustunde gorunen kayit cubugu
- **Panoya kopyalama**: Donusen metni otomatik panoya kopyalar
- **Global kisayol**: `Ctrl+Shift+Space` ile her yerden kayit baslat/durdur
- **Gecmis**: Onceki donusumleri goruntule ve duzenle
- **Dinamik prompt**: Kullanim alaniniza gore (teknik, tibbi, hukuki vb.) Whisper'a baglam verir
- **Model secimi**: Small'dan Large V3 Turbo'ya kadar farkli modeller
- **Sistem tepsisi**: Arka planda calisir, tray ikonundan erisim

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
2. Ayarlar panelinden "Model" sekmesine gidin
3. Bir model secip "Indir" butonuna basin:
   - **Small** (488 MB) — Hizli, test icin uygun
   - **Large V3 Turbo Q5** (574 MB) — Cok iyi kalite, hizli (onerilen)
   - **Large V3 Turbo** (1.5 GB) — En iyi kalite
4. Indirme tamamlaninca modeli secin ve kullanmaya baslayin

## Kullanim

### Temel Kullanim

1. **Kayit baslat**: `Ctrl+Shift+Space` tusuna basin veya overlay bardaki mikrofon ikonuna tiklayin
2. **Konusun**: Turkce veya sectiginiz dilde konusun
3. **Kayit durdur**: Ayni kisayolu tekrar basin
4. **Sonuc**: Metin otomatik islenir ve panoya kopyalanir, istediginiz yere yapistiriniz

### Overlay Bar

Ekranin altinda gorunen kucuk cubuk kayit durumunu gosterir:
- Mavi dalga: Kayit devam ediyor
- Turuncu: Donusum yapiliyor
- Imlecinizi takip eder, kayit sirasinda hangi ekranda oldugunuzu gosterir

### Ogrenme Sistemi

Fisilti kullandikca ogrenmeye devam eder:
- **Otomatik ogrenme**: Pipeline'in yaptigi Turkce karakter duzeltmelerini ogrenir
- **Manuel duzeltme**: Gecmis sekmesinde bir donusumu duzenlerseniz, fark otomatik ogrenilir
- **Sozluk**: Ogrenme panelinden ogrenilen duzeltmeleri gorup yonetebilirsiniz

### Ayarlar

| Ayar | Aciklama |
|------|----------|
| Dil | Donusum dili (Turkce varsayilan) |
| Turkce duzeltme | Whisper'in ASCII ciktilarini Turkce karakterlere cevirir |
| Halusinasyon filtresi | Tekrar eden veya anlamsiz ciktilari engeller |
| Otomatik noktalama | Cumle sonuna nokta, soru isareti vb. ekler |
| Otomatik virgul | Baglaclardan once virgul ekler |
| Buyuk harf | Cumle baslarini buyuk harfle baslatir |
| Ingilizce kelime koruma | Turkce metin icindeki Ingilizce kelimelere dokunmaz |
| Panoya kopyala | Sonucu otomatik panoya kopyalar |
| Dogrudan yaz | Sonucu aktif uygulamaya yazar |
| Paragraf modu | Her cumleyi yeni satira yazar |

## Proje Yapisi

```
fisilti/
├── src/                    # React frontend
│   ├── components/         # UI bilesenleri
│   │   ├── OverlayBar.tsx     # Overlay kayit cubugu
│   │   ├── RecordButton.tsx   # Kayit butonu
│   │   ├── SettingsPanel.tsx  # Ayarlar paneli
│   │   ├── HistoryPanel.tsx   # Gecmis paneli
│   │   ├── LearningPanel.tsx  # Ogrenme paneli
│   │   ├── ModelManager.tsx   # Model yonetimi
│   │   └── ...
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/              # Rust backend (Tauri)
│   ├── src/
│   │   ├── audio.rs           # Ses yakalama (cpal)
│   │   ├── transcription.rs   # Whisper donusum
│   │   ├── text.rs            # Metin isleme pipeline
│   │   ├── corrections.rs     # Ogrenme sistemi + sozluk
│   │   ├── model.rs           # Whisper model yonetimi
│   │   ├── settings.rs        # Uygulama ayarlari
│   │   ├── commands/          # Tauri komut handlerlari
│   │   └── lib.rs             # Uygulama giris noktasi
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
- **Tailwind CSS 4** — Stil
- **Zustand** — State yonetimi
- **cpal** — Ses yakalama
- **enigo** — Klavye simulasyonu (dogrudan yazma)

## Lisans

MIT License — Detaylar icin [LICENSE](LICENSE) dosyasina bakin.
