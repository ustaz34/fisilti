/// UIA Read-Along: Kaynak uygulamada kelime vurgulama
/// Select() KULLANMAZ — bunun yerine GetBoundingRectangles() ile kelimenin
/// ekran koordinatlarini alir ve yari-seffaf bir Win32 overlay penceresi ile
/// vurgular. Narrator/ekran okuyucu mantigi ile ayni.

#[cfg(target_os = "windows")]
use std::sync::mpsc;
#[cfg(target_os = "windows")]
use std::sync::Mutex;

#[cfg(target_os = "windows")]
enum UiaCommand {
    InitContext,
    HighlightWord { char_offset: u32, char_length: u32 },
    RestoreAndCleanup,
}

#[cfg(target_os = "windows")]
static UIA_SENDER: Mutex<Option<mpsc::Sender<UiaCommand>>> = Mutex::new(None);
static UIA_SUPPORTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static UIA_THREAD_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Highlight overlay penceresinin HWND'si
#[cfg(target_os = "windows")]
static HIGHLIGHT_HWND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

#[cfg(target_os = "windows")]
fn ensure_uia_thread() {
    use std::sync::atomic::Ordering;

    if UIA_THREAD_STARTED.load(Ordering::Relaxed) {
        return;
    }

    let (tx, rx) = mpsc::channel::<UiaCommand>();
    {
        let mut sender = UIA_SENDER.lock().unwrap();
        *sender = Some(tx);
    }
    UIA_THREAD_STARTED.store(true, Ordering::Relaxed);

    std::thread::spawn(move || {
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize,
            CLSCTX_ALL, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Accessibility::{
            CUIAutomation, IUIAutomation, IUIAutomationTextPattern,
            IUIAutomationTextPattern2, IUIAutomationTextRange,
            UIA_TextPatternId, UIA_TextPattern2Id, TextUnit_Character,
            TextPatternRangeEndpoint_Start, TextPatternRangeEndpoint_End,
        };
        use windows::core::Interface;
        use std::sync::atomic::Ordering;

        // Thread ölürse flag'i sıfırla (restart edilebilsin)
        struct ThreadGuard;
        impl Drop for ThreadGuard {
            fn drop(&mut self) {
                eprintln!("[uia-highlight] Thread sonlaniyor, restart icin flag sifirlaniyor");
                UIA_THREAD_STARTED.store(false, std::sync::atomic::Ordering::Relaxed);
            }
        }
        let _guard = ThreadGuard;

        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }

        // Highlight overlay penceresini olustur
        create_highlight_window();

        // Thread-local state
        let mut automation: Option<IUIAutomation> = None;
        let mut selection_range: Option<IUIAutomationTextRange> = None; // seçim aralığı — vurgulama için temel
        let mut _text_pattern: Option<IUIAutomationTextPattern> = None;
        let mut _text_pattern2: Option<IUIAutomationTextPattern2> = None;
        let mut last_highlight_time = std::time::Instant::now();
        let min_interval = std::time::Duration::from_millis(30);
        let mut highlight_log_count: u32 = 0;

        for cmd in rx {
            match cmd {
                UiaCommand::InitContext => {
                    UIA_SUPPORTED.store(false, Ordering::Relaxed);
                    selection_range = None;
                    _text_pattern = None;
                    _text_pattern2 = None;
                    highlight_log_count = 0;

                    unsafe {
                        // UIAutomation olustur
                        if automation.is_none() {
                            match CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_ALL) {
                                Ok(a) => automation = Some(a),
                                Err(e) => {
                                    eprintln!("[uia-highlight] UIAutomation olusturulamadi: {}", e);
                                    continue;
                                }
                            }
                        }

                        let auto = automation.as_ref().unwrap();

                        // HWND'den element al, yoksa focused element dene
                        let hwnd = crate::commands::input::get_last_foreground_hwnd();
                        let element = if hwnd != 0 {
                            use windows::Win32::Foundation::HWND;
                            let hwnd_handle = HWND(hwnd as *mut _);
                            eprintln!("[uia-highlight] HWND={} ile element aliniyor", hwnd);
                            auto.ElementFromHandle(hwnd_handle)
                                .or_else(|_| {
                                    eprintln!("[uia-highlight] ElementFromHandle basarisiz, GetFocusedElement deneniyor");
                                    auto.GetFocusedElement()
                                })
                        } else {
                            eprintln!("[uia-highlight] HWND=0, dogrudan GetFocusedElement kullaniliyor");
                            auto.GetFocusedElement()
                        };

                        let element = match element {
                            Ok(e) => e,
                            Err(e) => {
                                eprintln!("[uia-highlight] Element alinamadi: {}", e);
                                continue;
                            }
                        };

                        // Focused element'i de dene (daha spesifik olabilir — text control vs window)
                        let focused = auto.GetFocusedElement().ok();
                        let target = focused.as_ref().unwrap_or(&element);

                        // TextPattern2 dene, sonra TextPattern fallback
                        let mut got_pattern = false;
                        if let Ok(pattern_unk) = target.GetCurrentPattern(UIA_TextPattern2Id) {
                            let raw: *mut std::ffi::c_void = std::mem::transmute_copy(&pattern_unk);
                            if !raw.is_null() {
                                if let Ok(tp2) = pattern_unk.cast::<IUIAutomationTextPattern2>() {
                                    _text_pattern2 = Some(tp2);
                                    got_pattern = true;
                                    eprintln!("[uia-highlight] TextPattern2 destekleniyor");
                                }
                            }
                        }
                        if !got_pattern {
                            if let Ok(pattern_unk) = target.GetCurrentPattern(UIA_TextPatternId) {
                                let raw: *mut std::ffi::c_void = std::mem::transmute_copy(&pattern_unk);
                                if !raw.is_null() {
                                    if let Ok(tp) = pattern_unk.cast::<IUIAutomationTextPattern>() {
                                        _text_pattern = Some(tp);
                                        got_pattern = true;
                                        eprintln!("[uia-highlight] TextPattern destekleniyor");
                                    }
                                }
                            }
                        }

                        if got_pattern {
                            // Dogrudan SECIM ARALIGINI al — DocumentRange yerine.
                            // Edge TTS offset'leri secili metne gore, secim araligini temel alarak
                            // cok daha dogrudan ve guvenilir vurgulama yapabiliriz.
                            let sel_array = if let Some(ref tp2) = _text_pattern2 {
                                tp2.GetSelection().ok()
                            } else if let Some(ref tp) = _text_pattern {
                                tp.GetSelection().ok()
                            } else {
                                None
                            };

                            if let Some(ref sel_arr) = sel_array {
                                if let Ok(length) = sel_arr.Length() {
                                    if length > 0 {
                                        if let Ok(sel) = sel_arr.GetElement(0) {
                                            // Debug: secim metnini kontrol et
                                            if let Ok(t) = sel.GetText(120) {
                                                let s = t.to_string();
                                                // chars() ile guvenli truncate (UTF-8 byte boundary sorunu yok)
                                                let preview: String = s.chars().take(100).collect();
                                                eprintln!("[uia-highlight] Secim metni: {:?}", preview);
                                            }
                                            selection_range = Some(sel);
                                        }
                                    }
                                }
                            }

                            if selection_range.is_some() {
                                UIA_SUPPORTED.store(true, Ordering::Relaxed);
                                eprintln!("[uia-highlight] Init basarili, selection range hazir");
                            } else {
                                // Secim bulunamadi — DocumentRange fallback
                                eprintln!("[uia-highlight] Secim bulunamadi, DocumentRange fallback");
                                let doc = if let Some(ref tp2) = _text_pattern2 {
                                    tp2.DocumentRange().ok()
                                } else if let Some(ref tp) = _text_pattern {
                                    tp.DocumentRange().ok()
                                } else {
                                    None
                                };
                                if doc.is_some() {
                                    selection_range = doc;
                                    UIA_SUPPORTED.store(true, Ordering::Relaxed);
                                } else {
                                    eprintln!("[uia-highlight] DocumentRange da alinamadi");
                                }
                            }
                        } else {
                            eprintln!("[uia-highlight] TextPattern desteklenmiyor");
                        }
                    }
                }

                UiaCommand::HighlightWord { char_offset, char_length } => {
                    // Throttle
                    let now = std::time::Instant::now();
                    if now.duration_since(last_highlight_time) < min_interval {
                        continue;
                    }
                    last_highlight_time = now;

                    if let Some(ref base_range) = selection_range {
                        unsafe {
                            if let Ok(range) = base_range.Clone() {
                                // ── YENİ YAKLAŞIM ──
                                // 1. Collapse: End'i Start'a taşı → degenerate range (seçim başında)
                                let _ = range.MoveEndpointByRange(
                                    TextPatternRangeEndpoint_End,
                                    &range,
                                    TextPatternRangeEndpoint_Start,
                                );
                                // Şimdi: Start=sel_start, End=sel_start

                                // 2. End'i ilerlet: char_offset + char_length kadar
                                //    (önce End'i ilerletmek lazım, çünkü Start > End olamaz)
                                let _ = range.MoveEndpointByUnit(
                                    TextPatternRangeEndpoint_End,
                                    TextUnit_Character,
                                    (char_offset + char_length) as i32,
                                );
                                // Şimdi: Start=sel_start, End=sel_start + char_offset + char_length

                                // 3. Start'ı ilerlet: char_offset kadar
                                let _ = range.MoveEndpointByUnit(
                                    TextPatternRangeEndpoint_Start,
                                    TextUnit_Character,
                                    char_offset as i32,
                                );
                                // Şimdi: Start=sel_start + char_offset, End=sel_start + char_offset + char_length
                                // = hedef kelimenin/cumlenin tam araligi

                                // Debug: ilk birkac vurgulamayi logla
                                if highlight_log_count < 5 {
                                    highlight_log_count += 1;
                                    if let Ok(t) = range.GetText(40) {
                                        eprintln!("[uia-highlight] Vurgulanan[{}]: off={} len={} text={:?}",
                                            highlight_log_count, char_offset, char_length, t.to_string());
                                    }
                                }

                                // GetBoundingRectangles ile kelimenin/cumlenin ekran koordinatlarini al
                                match range.GetBoundingRectangles() {
                                    Ok(sa_ptr) => {
                                        let rects = parse_bounding_rects(sa_ptr);
                                        if !rects.is_empty() {
                                            // Tum dikdortgenleri birlestir (cumle modu icin cok satirli destek)
                                            let mut min_x = rects[0].0;
                                            let mut min_y = rects[0].1;
                                            let mut max_right = rects[0].0 + rects[0].2;
                                            let mut max_bottom = rects[0].1 + rects[0].3;
                                            for r in &rects[1..] {
                                                if r.0 < min_x { min_x = r.0; }
                                                if r.1 < min_y { min_y = r.1; }
                                                let right = r.0 + r.2;
                                                let bottom = r.1 + r.3;
                                                if right > max_right { max_right = right; }
                                                if bottom > max_bottom { max_bottom = bottom; }
                                            }
                                            move_highlight(
                                                min_x as i32,
                                                min_y as i32,
                                                (max_right - min_x) as i32,
                                                (max_bottom - min_y) as i32,
                                            );
                                        } else {
                                            hide_highlight();
                                        }
                                    }
                                    Err(e) => {
                                        eprintln!("[uia-highlight] GetBoundingRectangles hatasi: {}", e);
                                        hide_highlight();
                                    }
                                }
                            }
                        }
                    }
                }

                UiaCommand::RestoreAndCleanup => {
                    hide_highlight();
                    selection_range = None;
                    _text_pattern = None;
                    _text_pattern2 = None;
                    UIA_SUPPORTED.store(false, std::sync::atomic::Ordering::Relaxed);
                    eprintln!("[uia-highlight] Temizlendi");
                }
            }
        }

        unsafe {
            CoUninitialize();
        }
    });
}

/// SAFEARRAY<double> -> Vec<(left, top, width, height)>
/// SAFEARRAY struct'ini dogrudan okuyarak parse eder (SafeArray helper fonksiyonlarina ihtiyac yok)
#[cfg(target_os = "windows")]
unsafe fn parse_bounding_rects(sa: *mut windows::Win32::System::Com::SAFEARRAY) -> Vec<(f64, f64, f64, f64)> {
    extern "system" {
        fn SafeArrayDestroy(psa: *mut std::ffi::c_void) -> i32;
    }

    let mut result = Vec::new();
    if sa.is_null() {
        return result;
    }

    // SAFEARRAY struct'indan dogrudan oku
    let sa_ref = &*sa;
    let count = sa_ref.rgsabound[0].cElements as usize;
    let data = sa_ref.pvData as *const f64;

    if !data.is_null() && count >= 4 {
        let rect_count = count / 4;
        for i in 0..rect_count {
            let base = i * 4;
            let left = *data.add(base);
            let top = *data.add(base + 1);
            let width = *data.add(base + 2);
            let height = *data.add(base + 3);
            if width > 0.0 && height > 0.0 {
                result.push((left, top, width, height));
            }
        }
    }

    // SAFEARRAY'i serbest birak
    SafeArrayDestroy(sa as *mut std::ffi::c_void);

    result
}

/// Highlight overlay penceresini olustur — yari-seffaf sari dikdortgen
#[cfg(target_os = "windows")]
fn create_highlight_window() {
    use std::sync::atomic::Ordering;

    extern "system" {
        fn RegisterClassExW(wc: *const WndClassExW) -> u16;
        fn CreateWindowExW(
            ex: u32, class: *const u16, title: *const u16, style: u32,
            x: i32, y: i32, w: i32, h: i32,
            parent: isize, menu: isize, inst: isize, param: isize,
        ) -> isize;
        fn GetModuleHandleW(name: *const u16) -> isize;
        fn DefWindowProcW(hwnd: isize, msg: u32, wp: usize, lp: isize) -> isize;
        fn SetLayeredWindowAttributes(hwnd: isize, color: u32, alpha: u8, flags: u32) -> i32;
    }

    #[repr(C)]
    struct WndClassExW {
        size: u32,
        style: u32,
        wndproc: unsafe extern "system" fn(isize, u32, usize, isize) -> isize,
        cls_extra: i32,
        wnd_extra: i32,
        instance: isize,
        icon: isize,
        cursor: isize,
        background: isize,
        menu_name: *const u16,
        class_name: *const u16,
        icon_sm: isize,
    }

    unsafe extern "system" fn wnd_proc(hwnd: isize, msg: u32, wp: usize, lp: isize) -> isize {
        DefWindowProcW(hwnd, msg, wp, lp)
    }

    const WS_EX_LAYERED: u32 = 0x00080000;
    const WS_EX_TRANSPARENT: u32 = 0x00000020;
    const WS_EX_TOPMOST: u32 = 0x00000008;
    const WS_EX_NOACTIVATE: u32 = 0x08000000;
    const WS_EX_TOOLWINDOW: u32 = 0x00000080;
    const WS_POPUP: u32 = 0x80000000;
    const LWA_ALPHA: u32 = 0x00000002;

    unsafe {
        let hinst = GetModuleHandleW(std::ptr::null());

        // Window class ismi: UTF-16
        let class_name: Vec<u16> = "FisiltiHighlight\0".encode_utf16().collect();

        let wc = WndClassExW {
            size: std::mem::size_of::<WndClassExW>() as u32,
            style: 0,
            wndproc: wnd_proc,
            cls_extra: 0,
            wnd_extra: 0,
            instance: hinst,
            icon: 0,
            cursor: 0,
            // Sari arka plan rengi: RGB(255, 230, 0) = 0x0000E6FF (BGR formatinda)
            background: 0, // CreateSolidBrush yerine layered kullanacagiz
            menu_name: std::ptr::null(),
            class_name: class_name.as_ptr(),
            icon_sm: 0,
        };

        RegisterClassExW(&wc);

        let title: Vec<u16> = "\0".encode_utf16().collect();

        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_POPUP,
            0, 0, 1, 1, // baslangicta 1x1 gizli
            0, 0, hinst, 0,
        );

        if hwnd != 0 {
            // Sari-turuncu renk, %45 opaklık — okunaklı ama göze batmayan vurgulama
            SetLayeredWindowAttributes(hwnd, 0, 115, LWA_ALPHA);

            // Arka plan rengini sari yap — GDI brush ile boyayacagiz
            // Aslinda layered + alpha ile basit bir sari dikdortgen yapacagiz
            // CreateSolidBrush ile pencere arka planini boyamak lazim
            // Bunun yerine WM_PAINT'te boyayacagiz — veya background brush kullanalim

            HIGHLIGHT_HWND.store(hwnd, Ordering::Relaxed);
            eprintln!("[uia-highlight] Highlight penceresi olusturuldu: HWND={}", hwnd);
        } else {
            eprintln!("[uia-highlight] HATA: Highlight penceresi olusturulamadi!");
        }
    }
}

/// Highlight penceresini belirtilen ekran koordinatlarina tasi ve goster
#[cfg(target_os = "windows")]
fn move_highlight(x: i32, y: i32, w: i32, h: i32) {
    use std::sync::atomic::Ordering;

    extern "system" {
        fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, w: i32, h: i32, flags: u32) -> i32;
        fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
    }

    let hwnd = HIGHLIGHT_HWND.load(Ordering::Relaxed);
    if hwnd == 0 { return; }

    const HWND_TOPMOST: isize = -1;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    const SW_SHOWNOACTIVATE: i32 = 4;

    // Kucuk padding ekle (daha iyi goruntulenme icin)
    let pad = 2;

    unsafe {
        SetWindowPos(
            hwnd, HWND_TOPMOST,
            x - pad, y - pad,
            w + pad * 2, h + pad * 2,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);

        // Pencereyi sari ile yeniden boya
        paint_highlight_yellow(hwnd, w + pad * 2, h + pad * 2);
    }
}

/// Highlight penceresini sari renk ile boya
#[cfg(target_os = "windows")]
unsafe fn paint_highlight_yellow(hwnd: isize, w: i32, h: i32) {
    extern "system" {
        fn GetDC(hwnd: isize) -> isize;
        fn ReleaseDC(hwnd: isize, dc: isize) -> i32;
        fn CreateSolidBrush(color: u32) -> isize;
        fn FillRect(dc: isize, rect: *const [i32; 4], brush: isize) -> i32;
        fn DeleteObject(obj: isize) -> i32;
    }

    let dc = GetDC(hwnd);
    if dc == 0 { return; }

    // Sari-turuncu renk: RGB(255, 200, 50) -> BGR: 0x0032C8FF
    let brush = CreateSolidBrush(0x0032C8FF);
    let rect = [0i32, 0, w, h];
    FillRect(dc, &rect, brush);
    DeleteObject(brush);
    ReleaseDC(hwnd, dc);
}

/// Highlight penceresini gizle
#[cfg(target_os = "windows")]
fn hide_highlight() {
    use std::sync::atomic::Ordering;

    extern "system" {
        fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
    }

    let hwnd = HIGHLIGHT_HWND.load(Ordering::Relaxed);
    if hwnd == 0 { return; }

    const SW_HIDE: i32 = 0;
    unsafe {
        ShowWindow(hwnd, SW_HIDE);
    }
}

/// Read-along baslat: kaynak uygulamadan UIA TextPattern al
/// true donerse destekleniyor, false donerse vurgulama calismayacak
pub fn init_read_along() -> bool {
    #[cfg(target_os = "windows")]
    {
        ensure_uia_thread();
        let send_ok = {
            if let Ok(sender) = UIA_SENDER.lock() {
                if let Some(tx) = sender.as_ref() {
                    tx.send(UiaCommand::InitContext).is_ok()
                } else { false }
            } else { false }
        };

        if !send_ok {
            // Thread olmus olabilir — yeniden baslat
            eprintln!("[uia-highlight] Thread olmus, yeniden baslatiliyor...");
            UIA_THREAD_STARTED.store(false, std::sync::atomic::Ordering::Relaxed);
            *UIA_SENDER.lock().unwrap() = None;
            ensure_uia_thread();
            // Tekrar dene
            if let Ok(sender) = UIA_SENDER.lock() {
                if let Some(tx) = sender.as_ref() {
                    tx.send(UiaCommand::InitContext).ok();
                }
            }
        }

        // COM thread'in init etmesi icin yeterli sure bekle
        std::thread::sleep(std::time::Duration::from_millis(300));
        return UIA_SUPPORTED.load(std::sync::atomic::Ordering::Relaxed);
    }
    #[cfg(not(target_os = "windows"))]
    false
}

/// Belirtilen karakter araligini kaynak uygulamada vurgula (overlay ile)
pub fn highlight_word(char_offset: u32, char_length: u32) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(sender) = UIA_SENDER.lock() {
            if let Some(tx) = sender.as_ref() {
                tx.send(UiaCommand::HighlightWord { char_offset, char_length }).ok();
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (char_offset, char_length);
    }
}

/// Read-along durdur: highlight gizle ve temizle
pub fn stop_read_along() {
    #[cfg(target_os = "windows")]
    {
        if let Ok(sender) = UIA_SENDER.lock() {
            if let Some(tx) = sender.as_ref() {
                tx.send(UiaCommand::RestoreAndCleanup).ok();
            }
        }
    }
}
