mod audio;
mod commands;
mod corrections;
mod edge_tts;
mod keyboard_hook;
mod model;
mod settings;
mod text;
mod transcription;

use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
#[cfg(target_os = "windows")]
use windows::core::Interface;

/// Overlay penceresinin Win32 HWND'si (setup_overlay_win32 tarafindan set edilir)
static OVERLAY_HWND: AtomicIsize = AtomicIsize::new(0);
/// Overlay'in orijinal WndProc'u (subclassing icin)
static ORIGINAL_WNDPROC: AtomicIsize = AtomicIsize::new(0);
/// Overlay'in imleci takip edip etmeyecegi
static OVERLAY_FOLLOW_CURSOR: AtomicBool = AtomicBool::new(true);
/// Overlay bar'in aktif durumu (recording veya transcribing = true)
static OVERLAY_BAR_ACTIVE: AtomicBool = AtomicBool::new(false);
/// Kisayol duzenleme modu — true iken global kisayollar askiya alinir
pub(crate) static SHORTCUTS_SUSPENDED: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Ikinci instance acildiginda mevcut pencereyi one getir
            show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let app_handle = app.handle().clone();
            // Models dizinini olustur
            let models_dir = model::get_models_dir(&app_handle);
            std::fs::create_dir_all(&models_dir).ok();
            log::info!("Models dizini: {:?}", models_dir);

            // Kullanici duzeltme sozlugu ve profilini yukle
            corrections::load_corrections(&app_handle);
            corrections::load_profile(&app_handle);

            // Sistem tepsisi olustur
            let show_item = MenuItemBuilder::with_id("show", "Göster")
                .build(app)?;
            let tts_item = MenuItemBuilder::with_id("tts_clipboard", "Panodaki Metni Oku")
                .build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Çıkış")
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&tts_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))
                .expect("Tray ikonu yuklenemedi");

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("Fısıltı - Ses Yazı Dönüştürücü")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            show_main(app);
                        }
                        "tts_clipboard" => {
                            // Panodaki metni TTS ile oku
                            let app_clone = app.clone();
                            std::thread::spawn(move || {
                                let clip_text = arboard::Clipboard::new()
                                    .and_then(|mut cb| cb.get_text())
                                    .unwrap_or_default();
                                if !clip_text.trim().is_empty() {
                                    if let Some(window) = app_clone.get_webview_window("main") {
                                        window.emit("tts-speak-text", &clip_text).ok();
                                    }
                                }
                            });
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        show_main(app);
                    }
                })
                .build(app)?;

            // Global kisayol kaydet
            setup_global_shortcut(&app_handle);

            // TTS global kisayol kaydet
            setup_tts_shortcut(&app_handle);

            // Overlay penceresi - baslik temizle, konumlandir, goster
            if let Some(window) = app.get_webview_window("overlay") {
                window.set_title("").ok();

                // WebView2 arka planini tam seffaf yap (beyaz tabaka sorunu icin)
                use tauri::webview::Color;
                window.set_background_color(Some(Color(0, 0, 0, 0))).ok();

                // Baslangicta tum pencere click-through (idle)
                window.set_ignore_cursor_events(true).ok();

                snap_overlay_to_bottom(&window);
                window.show().ok();

                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        window_clone.hide().ok();
                    }
                });
            }

            // Win32 stillerini gecikmeyle uygula + seffaflik duzelt
            setup_overlay_win32(app.handle().clone());

            // Ana pencere - kapatinca tepsiye gizle
            if let Some(window) = app.get_webview_window("main") {
                // WebView2 arka planini seffaf yap (transparent: true uyumu)
                use tauri::webview::Color as MainColor;
                window.set_background_color(Some(MainColor(0, 0, 0, 0))).ok();

                window.show().ok();
                window.set_focus().ok();

                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        window_clone.hide().ok();
                    }
                });
            }

            // Ana pencereye DWM frame extension uygula (transparent + decorations:false click fix)
            setup_main_window_win32(app.handle().clone());

            // Overlay follow cursor ayarini yukle
            {
                let settings = commands::settings::get_settings(app_handle.clone());
                OVERLAY_FOLLOW_CURSOR.store(settings.overlay_follow_cursor, Ordering::Relaxed);
            }

            // Overlay'in mouse imlecini monitorler arasi takip etmesini baslat
            start_overlay_cursor_tracking(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::audio::list_audio_devices,
            commands::audio::start_recording,
            commands::audio::stop_recording,
            commands::audio::get_audio_levels,
            commands::transcription::transcribe_audio,
            commands::transcription::get_transcription_status,
            commands::transcription::process_text_command,
            commands::model::list_models,
            commands::model::download_model,
            commands::model::get_download_progress,
            commands::model::delete_model,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::input::paste_to_active_app,
            commands::input::save_foreground_window,
            commands::input::restore_foreground_window,
            commands::history::save_history_entry,
            commands::history::get_history,
            commands::history::clear_history,
            commands::corrections::add_user_correction,
            commands::corrections::remove_user_correction,
            commands::corrections::get_user_corrections,
            commands::corrections::learn_from_edit,
            commands::corrections::get_user_profile,
            commands::corrections::get_dynamic_prompt_preview,
            commands::corrections::get_ngram_stats,
            commands::corrections::get_domain_info,
            commands::corrections::reset_learning_data,
            commands::corrections::export_corrections,
            commands::corrections::import_corrections,
            commands::corrections::report_correction_revert,
            commands::corrections::promote_correction,
            commands::corrections::demote_correction,
            show_main_window,
            hide_main_window,
            change_shortcut,
            change_tts_shortcut,
            set_overlay_follow_cursor,
            set_overlay_bar_active,
            suspend_shortcuts,
            resume_shortcuts,
            edge_tts_get_voices,
            edge_tts_synthesize,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri uygulamasi baslatilirken hata olustu");
}

/// Ana pencere WndProc — orijinal WndProc'u saklamak icin static
static MAIN_ORIGINAL_WNDPROC: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

/// Ana pencereye Win32 stil uygula — DWM cerceve/border'i tamamen kaldir
fn setup_main_window_win32(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));

        extern "system" {
            fn EnumWindows(cb: unsafe extern "system" fn(isize, isize) -> i32, lp: isize) -> i32;
            fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
            fn GetCurrentProcessId() -> u32;
            fn GetWindowRect(hwnd: isize, rect: *mut [i32; 4]) -> i32;
            fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
            fn SetWindowLongPtrW(hwnd: isize, index: i32, val: isize) -> isize;
            fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, w: i32, h: i32, flags: u32) -> i32;
            fn LoadLibraryA(name: *const u8) -> isize;
            fn GetProcAddress(module: isize, name: *const u8) -> isize;
            fn DefWindowProcW(hwnd: isize, msg: u32, wp: usize, lp: isize) -> isize;
            fn CallWindowProcW(prev: isize, hwnd: isize, msg: u32, wp: usize, lp: isize) -> isize;
        }

        const GWL_STYLE: i32 = -16;
        const GWL_EXSTYLE: i32 = -20;
        const GWLP_WNDPROC: i32 = -4;
        const WS_EX_APPWINDOW: isize = 0x00040000;
        const WS_CAPTION: isize = 0x00C00000;
        const WS_THICKFRAME: isize = 0x00040000;
        const WS_BORDER: isize = 0x00800000;
        const SWP_NOMOVE: u32 = 0x0002;
        const SWP_NOSIZE: u32 = 0x0001;
        const SWP_NOZORDER: u32 = 0x0004;
        const SWP_FRAMECHANGED: u32 = 0x0020;
        const WM_NCCALCSIZE: u32 = 0x0083;

        static MAIN_HWND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

        /// Subclassed WndProc: WM_NCCALCSIZE -> 0 dondurerek non-client area (1px ust border) kaldir
        unsafe extern "system" fn main_wndproc(hwnd: isize, msg: u32, wp: usize, lp: isize) -> isize {
            if msg == WM_NCCALCSIZE && wp == 1 {
                // wparam=TRUE: non-client alanini sifirla — 1px ust border kalkar
                return 0;
            }
            let orig = MAIN_ORIGINAL_WNDPROC.load(Ordering::Acquire);
            if orig != 0 {
                CallWindowProcW(orig, hwnd, msg, wp, lp)
            } else {
                DefWindowProcW(hwnd, msg, wp, lp)
            }
        }

        unsafe extern "system" fn find_main(hwnd: isize, our_pid: isize) -> i32 {
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid != our_pid as u32 { return 1; }

            let mut rect = [0i32; 4];
            GetWindowRect(hwnd, &mut rect);
            let w = rect[2] - rect[0];
            let h = rect[3] - rect[1];

            if w < 200 || h < 200 { return 1; }

            MAIN_HWND.store(hwnd, Ordering::Release);
            0
        }

        unsafe {
            let pid = GetCurrentProcessId();
            EnumWindows(find_main, pid as isize);
        }

        let hwnd = MAIN_HWND.load(Ordering::Acquire);
        if hwnd == 0 {
            eprintln!("[fisilti] Ana pencere HWND bulunamadi");
            return;
        }

        unsafe {
            // WS_CAPTION, WS_THICKFRAME, WS_BORDER kaldir
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            SetWindowLongPtrW(hwnd, GWL_STYLE, style & !WS_CAPTION & !WS_THICKFRAME & !WS_BORDER);

            // WS_EX_APPWINDOW — taskbar'da gorunsun
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_APPWINDOW);

            // WndProc subclass — WM_NCCALCSIZE yakalayarak 1px ust border kaldir
            let orig = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, main_wndproc as isize);
            MAIN_ORIGINAL_WNDPROC.store(orig, Ordering::Release);

            let dwm = LoadLibraryA(b"dwmapi.dll\0".as_ptr());
            if dwm != 0 {
                let attr_fn = GetProcAddress(dwm, b"DwmSetWindowAttribute\0".as_ptr());
                if attr_fn != 0 {
                    let f: unsafe extern "system" fn(isize, u32, *const u32, u32) -> i32 = std::mem::transmute(attr_fn);
                    // DWMWA_USE_IMMERSIVE_DARK_MODE (20)
                    let dark: u32 = 1;
                    f(hwnd, 20, &dark, 4);
                    // DWMWA_WINDOW_CORNER_PREFERENCE (33) = DWMWCP_ROUND (2)
                    // Yuvarlak koseler — CSS rounded-2xl ile uyumlu
                    let round: u32 = 2;
                    f(hwnd, 33, &round, 4);
                    // DWMWA_TRANSITIONS_FORCEDISABLED (2)
                    let v: u32 = 1;
                    f(hwnd, 2, &v, 4);
                }

                // DWM frame'i sifirla
                let ext_fn = GetProcAddress(dwm, b"DwmExtendFrameIntoClientArea\0".as_ptr());
                if ext_fn != 0 {
                    #[repr(C)]
                    struct Margins { l: i32, r: i32, t: i32, b: i32 }
                    let f: unsafe extern "system" fn(isize, *const Margins) -> i32 = std::mem::transmute(ext_fn);
                    f(hwnd, &Margins { l: 0, r: 0, t: 0, b: 0 });
                }
            }

            // Stil degisikligini etkinlestir
            SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);

            eprintln!("[fisilti] Ana pencere cerceve tamamen kaldirildi: HWND={}", hwnd);
        }

        let _ = app_handle;
    });
}

/// Overlay'i belirtilen monitorun alt ortasina konumlandir (sabit 300x48 logical)
/// Tauri'nin set_position/set_size yerine dogrudan Win32 SetWindowPos kullanir
/// boylece Tauri'nin DPI yonetimi (WM_DPICHANGED) araya girip bounce yaratamaz
fn position_overlay_on_monitor(_window: &tauri::WebviewWindow, monitor: &tauri::Monitor) {
    let hwnd = OVERLAY_HWND.load(Ordering::Relaxed);
    if hwnd == 0 { return; }

    let scale = monitor.scale_factor();
    let mon_pos = monitor.position();  // fiziksel piksel
    let mon_size = monitor.size();      // fiziksel piksel

    // Hedef monitorun DPI'sina gore fiziksel boyut
    let phys_w = (300.0 * scale) as i32;
    let phys_h = (48.0 * scale) as i32;

    // Fiziksel koordinatlarda pozisyon hesapla
    let x = mon_pos.x + (mon_size.width as i32 - phys_w) / 2;
    let y = mon_pos.y + mon_size.height as i32 - phys_h;

    eprintln!("[fisilti] position: monitor=({},{}) size={}x{} scale={} -> overlay pos=({},{}) phys={}x{}",
        mon_pos.x, mon_pos.y, mon_size.width, mon_size.height, scale, x, y, phys_w, phys_h);

    // Dogrudan Win32 SetWindowPos - Tauri bypass, bounce yok
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, w: i32, h: i32, flags: u32) -> i32;
        }
        const HWND_TOPMOST: isize = -1;
        const SWP_NOACTIVATE: u32 = 0x0010;
        unsafe {
            SetWindowPos(hwnd, HWND_TOPMOST, x, y, phys_w, phys_h, SWP_NOACTIVATE);
        }
    }
}

/// Overlay'i bulundugu monitorun altina yapistur
fn snap_overlay_to_bottom(window: &tauri::WebviewWindow) {
    let monitor = window.current_monitor().ok().flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        // HWND henuz set edilmediyse Tauri API ile konumlandir (ilk baslangic)
        if OVERLAY_HWND.load(Ordering::Relaxed) == 0 {
            let scale = monitor.scale_factor();
            let mon_pos = monitor.position();
            let mon_size = monitor.size();
            let phys_w = (300.0 * scale) as i32;
            let phys_h = (48.0 * scale) as i32;
            let x = mon_pos.x + (mon_size.width as i32 - phys_w) / 2;
            let y = mon_pos.y + mon_size.height as i32 - phys_h;
            window.set_position(tauri::Position::Physical(
                tauri::PhysicalPosition::new(x, y),
            )).ok();
        } else {
            position_overlay_on_monitor(window, &monitor);
        }
    }
}

/// Mouse imleci monitorler arasi gecince overlay'i takip ettir
fn start_overlay_cursor_tracking(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    std::thread::spawn(move || {
        #[repr(C)]
        #[derive(Copy, Clone)]
        struct Pt { x: i32, y: i32 }

        extern "system" {
            fn GetCursorPos(p: *mut Pt) -> i32;
        }

        let mut last_monitor_pos: Option<(i32, i32)> = None;

        // HWND'nin set edilmesini bekle
        loop {
            std::thread::sleep(std::time::Duration::from_millis(200));
            if OVERLAY_HWND.load(Ordering::Relaxed) != 0 { break; }
        }

        loop {
            std::thread::sleep(std::time::Duration::from_millis(200));

            if !OVERLAY_FOLLOW_CURSOR.load(Ordering::Relaxed) {
                continue;
            }

            let cursor = unsafe {
                let mut p = Pt { x: 0, y: 0 };
                GetCursorPos(&mut p);
                p
            };

            if let Some(window) = app_handle.get_webview_window("overlay") {
                if let Ok(monitors) = window.available_monitors() {
                    for monitor in monitors {
                        let mpos = monitor.position();
                        let msize = monitor.size();

                        if cursor.x >= mpos.x
                            && cursor.x < mpos.x + msize.width as i32
                            && cursor.y >= mpos.y
                            && cursor.y < mpos.y + msize.height as i32
                        {
                            let current_pos = (mpos.x, mpos.y);

                            if last_monitor_pos != Some(current_pos) {
                                last_monitor_pos = Some(current_pos);
                                position_overlay_on_monitor(&window, &monitor);
                                eprintln!(
                                    "[fisilti] Overlay monitör degisti: origin=({}, {})",
                                    mpos.x, mpos.y
                                );
                            }
                            break;
                        }
                    }
                }
            }
        }
    });
}

/// Overlay penceresine Win32 stillerini uygula: dekorasyon yok, fokus yok, seffaf
/// EnumWindows ile ust-seviye HWND'yi bulur, WM_DPICHANGED'i engeller (bounce fix)
fn setup_overlay_win32(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    std::thread::spawn(move || {
        // Pencerelerin tam olusmasini bekle
        std::thread::sleep(std::time::Duration::from_millis(500));

        extern "system" {
            fn EnumWindows(cb: unsafe extern "system" fn(isize, isize) -> i32, lp: isize) -> i32;
            fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
            fn GetCurrentProcessId() -> u32;
            fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
            fn SetWindowLongPtrW(hwnd: isize, index: i32, val: isize) -> isize;
            fn GetWindowRect(hwnd: isize, rect: *mut [i32; 4]) -> i32;
            fn LoadLibraryA(name: *const u8) -> isize;
            fn GetProcAddress(module: isize, name: *const u8) -> isize;
            fn DefWindowProcW(hwnd: isize, msg: u32, wp: usize, lp: isize) -> isize;
            fn CallWindowProcW(prev: isize, hwnd: isize, msg: u32, wp: usize, lp: isize) -> isize;
        }

        const GWL_EXSTYLE: i32 = -20;
        const GWL_STYLE: i32 = -16;
        const GWLP_WNDPROC: i32 = -4;
        const WS_EX_NOACTIVATE: isize = 0x08000000;
        const WS_EX_TOOLWINDOW: isize = 0x00000080;
        const WS_CAPTION: isize = 0x00C00000;
        const WS_THICKFRAME: isize = 0x00040000;
        const WS_BORDER: isize = 0x00800000;
        const WM_DPICHANGED: u32 = 0x02E0;
        const WM_NCHITTEST: u32 = 0x0084;
        const WM_NCACTIVATE: u32 = 0x0086;
        const WM_ACTIVATE: u32 = 0x0006;
        const HTTRANSPARENT: isize = -1;

        extern "system" {
            fn ScreenToClient(hwnd: isize, point: *mut [i32; 2]) -> i32;
            fn GetClientRect(hwnd: isize, rect: *mut [i32; 4]) -> i32;
        }

        /// Subclassed WndProc:
        /// - WM_DPICHANGED'i yutuyor (tao'nun bounce yaratmasini engeller)
        /// - WM_NCHITTEST: seffaf alanlari tiklamaya gecirgen yapar
        unsafe extern "system" fn overlay_wndproc(hwnd: isize, msg: u32, wp: usize, lp: isize) -> isize {
            if msg == WM_DPICHANGED {
                return 0;
            }

            // Aktivasyon/fokus mesajlarini engelle — beyaz cerceve goruntusunu onler
            if msg == WM_NCACTIVATE {
                // Non-client alanin yeniden cizilmesini engelle (cerceve flash'i)
                return 0;
            }
            if msg == WM_ACTIVATE {
                // Pencerenin aktif olmasini engelle
                return 0;
            }

            if msg == WM_NCHITTEST {
                // Imleç konumunu client koordinatlarina cevir
                let sx = (lp & 0xFFFF) as i16 as i32;
                let sy = ((lp >> 16) & 0xFFFF) as i16 as i32;
                let mut pt = [sx, sy];
                ScreenToClient(hwnd, &mut pt);

                let mut rc = [0i32; 4];
                GetClientRect(hwnd, &mut rc);
                let cw = rc[2]; // client width (fiziksel piksel)
                let ch = rc[3]; // client height (fiziksel piksel)

                if cw <= 0 || ch <= 0 {
                    return HTTRANSPARENT;
                }

                // Oransal konum (0.0 - 1.0)
                let rx = pt[0] as f64 / cw as f64;
                let ry = pt[1] as f64 / ch as f64;

                let is_active = OVERLAY_BAR_ACTIVE.load(Ordering::Relaxed);

                // Idle: tum pencere tamamen gecirgen — taskbar tiklamalari engellenmez
                if !is_active {
                    return HTTRANSPARENT;
                }

                // Aktif (kayit/donusum): sadece bar gorselinin oldugu dar alan
                // center %50, bottom %60 — kenarlar gecirgen kalir
                let (x_min, x_max, y_min) = (0.25, 0.75, 0.40);

                if rx >= x_min && rx <= x_max && ry >= y_min {
                    let orig = ORIGINAL_WNDPROC.load(Ordering::Acquire);
                    if orig != 0 {
                        return CallWindowProcW(orig, hwnd, msg, wp, lp);
                    } else {
                        return DefWindowProcW(hwnd, msg, wp, lp);
                    }
                }

                // Aktif ama bar disinda — gecirgen
                return HTTRANSPARENT;
            }

            let orig = ORIGINAL_WNDPROC.load(Ordering::Acquire);
            if orig != 0 {
                CallWindowProcW(orig, hwnd, msg, wp, lp)
            } else {
                DefWindowProcW(hwnd, msg, wp, lp)
            }
        }

        // Adim 1: EnumWindows ile overlay HWND'sini bul (sadece kaydet)
        unsafe extern "system" fn enum_cb(hwnd: isize, our_pid: isize) -> i32 {
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid != our_pid as u32 { return 1; }

            let mut rect = [0i32; 4];
            GetWindowRect(hwnd, &mut rect);
            let w = rect[2] - rect[0];
            let h = rect[3] - rect[1];

            // Overlay: genislik > 100 VE yukseklik 30-200 arasi
            if w < 100 || h < 30 || h >= 200 { return 1; }

            eprintln!("[fisilti] Overlay HWND bulundu: {}, boyut={}x{}", hwnd, w, h);
            OVERLAY_HWND.store(hwnd, Ordering::Release);
            0 // Bulundu, dur
        }

        // HWND bulunamazsa retry (maks 3 deneme, 500ms arayla)
        for attempt in 0..3 {
            unsafe {
                let pid = GetCurrentProcessId();
                EnumWindows(enum_cb, pid as isize);
            }

            let hwnd = OVERLAY_HWND.load(Ordering::Acquire);
            if hwnd != 0 {
                break;
            }

            if attempt < 2 {
                eprintln!("[fisilti] Overlay HWND bulunamadi, {}. deneme, 500ms sonra tekrar deneniyor...", attempt + 1);
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }

        let hwnd = OVERLAY_HWND.load(Ordering::Acquire);
        if hwnd == 0 {
            eprintln!("[fisilti] HATA: Overlay HWND bulunamadi (3 deneme sonrasi)!");
            return;
        }

        // Adim 2: Stilleri ve subclassing'i uygula (enum_cb disinda)
        unsafe {
            // Subclass: once orig'i kaydet, sonra set et
            let orig = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, overlay_wndproc as isize);
            ORIGINAL_WNDPROC.store(orig, Ordering::Release);
            eprintln!("[fisilti] WndProc subclass uygulandi, orig={}", orig);

            // WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW (WS_EX_LAYERED yok — WebView2 ile uyumsuz)
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE,
                ex | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW
            );

            // Pencere stilinden caption/border/frame tamamen kaldir
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            SetWindowLongPtrW(hwnd, GWL_STYLE,
                style & !WS_CAPTION & !WS_THICKFRAME & !WS_BORDER
            );

            // DWM: seffaflik + cerceve/border kaldir + gecis animasyonlarini kapat
            let dwm = LoadLibraryA(b"dwmapi.dll\0".as_ptr());
            if dwm != 0 {
                let ext_fn = GetProcAddress(dwm, b"DwmExtendFrameIntoClientArea\0".as_ptr());
                if ext_fn != 0 {
                    #[repr(C)]
                    struct M { l: i32, r: i32, t: i32, b: i32 }
                    let f: unsafe extern "system" fn(isize, *const M) -> i32 = std::mem::transmute(ext_fn);
                    f(hwnd, &M { l: -1, r: -1, t: -1, b: -1 });
                }
                let attr_fn = GetProcAddress(dwm, b"DwmSetWindowAttribute\0".as_ptr());
                if attr_fn != 0 {
                    let f: unsafe extern "system" fn(isize, u32, *const u32, u32) -> i32 = std::mem::transmute(attr_fn);
                    // DWMWA_TRANSITIONS_FORCEDISABLED = 2 → monitor gecis animasyonunu kapat
                    let v: u32 = 1;
                    f(hwnd, 2, &v, 4);
                    // DWMWCP_DONOTROUND = 1
                    let v: u32 = 1;
                    f(hwnd, 33, &v, 4);
                    // DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE
                    let v: u32 = 0xFFFFFFFE;
                    f(hwnd, 34, &v, 4);
                }
            }

            eprintln!("[fisilti] Overlay stiller uygulandi: HWND={}", hwnd);
        }

        // Seffaflik duzeltme workaround (Tauri v2 #8308)
        // Resize sonrasi DWM frame extension tekrar uygulanmali
        if let Some(window) = app_handle.get_webview_window("overlay") {
            window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(1.0, 1.0))).ok();
            std::thread::sleep(std::time::Duration::from_millis(100));
            window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(300.0, 48.0))).ok();
            std::thread::sleep(std::time::Duration::from_millis(50));

            // DWM frame extension'i resize sonrasi tekrar uygula
            unsafe {
                let dwm = LoadLibraryA(b"dwmapi.dll\0".as_ptr());
                if dwm != 0 {
                    let ext_fn = GetProcAddress(dwm, b"DwmExtendFrameIntoClientArea\0".as_ptr());
                    if ext_fn != 0 {
                        #[repr(C)]
                        struct M2 { l: i32, r: i32, t: i32, b: i32 }
                        let f: unsafe extern "system" fn(isize, *const M2) -> i32 = std::mem::transmute(ext_fn);
                        f(hwnd, &M2 { l: -1, r: -1, t: -1, b: -1 });
                    }
                }
            }

            snap_overlay_to_bottom(&window);
            eprintln!("[fisilti] Overlay seffaflik workaround uygulandi");
        }
    });
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.show().ok();
        window.set_focus().ok();
    }
    // Overlay da göster
    if let Some(window) = app.get_webview_window("overlay") {
        window.show().ok();
    }
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().ok();
    }
}

fn register_shortcut(app_handle: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let app = app_handle.clone();
    app_handle.global_shortcut().on_shortcut(shortcut, move |_app, sc, event| {
        // Kisayol duzenleme modundaysa yoksay
        if SHORTCUTS_SUSPENDED.load(Ordering::Relaxed) { return; }
        match event.state {
            tauri_plugin_global_shortcut::ShortcutState::Pressed => {
                commands::input::save_foreground_internal();
                log::info!("Global kisayol basildi: {:?}", sc);
                if let Some(window) = app.get_webview_window("overlay") {
                    window.show().ok();
                    window.emit("shortcut-key-down", ()).ok();
                }
            }
            tauri_plugin_global_shortcut::ShortcutState::Released => {
                log::info!("Global kisayol birakildi: {:?}", sc);
                if let Some(window) = app.get_webview_window("overlay") {
                    window.emit("shortcut-key-up", ()).ok();
                }
            }
        }
    }).map_err(|e| format!("{}", e))
}

fn setup_global_shortcut(app_handle: &tauri::AppHandle) {
    // Kaydedilmis kisayolu yukle, yoksa varsayilan
    let shortcut = {
        use tauri_plugin_store::StoreExt;
        app_handle.store("settings.json").ok()
            .and_then(|store| store.get("shortcut"))
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "Ctrl+Shift+Space".to_string())
    };

    // Keyboard hook'u baslat (tek tus destegi icin)
    keyboard_hook::install(app_handle.clone());

    if keyboard_hook::is_single_key(&shortcut) {
        // Tek tus — hook ile yakala
        if let Some(vk) = keyboard_hook::key_name_to_vk(&shortcut) {
            keyboard_hook::set_key(vk);
            log::info!("Klavye hook ile kisayol kaydedildi: {} (vk={:#x})", shortcut, vk);
        } else {
            log::warn!("Bilinmeyen tus: {}, varsayilan kisayola donuluyor", shortcut);
            match register_shortcut(app_handle, "Ctrl+Shift+Space") {
                Ok(_) => log::info!("Varsayilan kisayol kaydedildi: Ctrl+Shift+Space"),
                Err(e) => log::warn!("Varsayilan kisayol kaydedilemedi: {}", e),
            }
        }
    } else {
        // Modifier kombinasyonu — global shortcut ile yakala
        match register_shortcut(app_handle, &shortcut) {
            Ok(_) => log::info!("Global kisayol kaydedildi: {}", shortcut),
            Err(e) => log::warn!("Global kisayol kaydedilemedi: {}", e),
        }
    }
}

#[tauri::command]
fn set_overlay_follow_cursor(enabled: bool) {
    OVERLAY_FOLLOW_CURSOR.store(enabled, Ordering::Relaxed);
    log::info!("Overlay follow cursor: {}", enabled);
}

#[tauri::command]
fn suspend_shortcuts() {
    SHORTCUTS_SUSPENDED.store(true, Ordering::Relaxed);
    eprintln!("[fisilti] Global kisayollar askiya alindi (duzenleme modu)");
}

#[tauri::command]
fn resume_shortcuts() {
    SHORTCUTS_SUSPENDED.store(false, Ordering::Relaxed);
    eprintln!("[fisilti] Global kisayollar tekrar aktif");
}

#[tauri::command]
fn set_overlay_bar_active(app: tauri::AppHandle, active: bool) {
    OVERLAY_BAR_ACTIVE.store(active, Ordering::Relaxed);
    // WebView2 katmanini da kontrol et — HTTRANSPARENT tek basina yetmiyor
    if let Some(window) = app.get_webview_window("overlay") {
        // idle → tum pencere tamamen gecirgen (WebView2 dahil)
        // aktif → pencere mouse olaylarini alir, WndProc + CSS hit-test yapar
        let _ = window.set_ignore_cursor_events(!active);
    }
}

#[tauri::command]
fn change_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    // Onceki global shortcut'lari temizle (hook haric)
    app.global_shortcut().unregister_all()
        .map_err(|e| format!("Kisayollar kaldirilamadi: {}", e))?;

    // Hook'un hedef tusunu sifirla
    keyboard_hook::set_key(0);

    if keyboard_hook::is_single_key(&shortcut) {
        // Tek tus — hook ile yakala
        let vk = keyboard_hook::key_name_to_vk(&shortcut)
            .ok_or_else(|| format!("Bilinmeyen tus: {}", shortcut))?;
        keyboard_hook::set_key(vk);
        log::info!("Kisayol degistirildi (hook): {} (vk={:#x})", shortcut, vk);
    } else {
        // Modifier kombinasyonu — global shortcut ile yakala
        register_shortcut(&app, &shortcut).map_err(|e| {
            log::warn!("Kisayol atanamadi: {}", e);
            format!("Gecersiz kisayol: {}", shortcut)
        })?;
        log::info!("Kisayol degistirildi (global): {}", shortcut);
    }

    // TTS kisayolunu tekrar kaydet (hook veya global)
    let tts_shortcut = {
        use tauri_plugin_store::StoreExt;
        app.store("settings.json").ok()
            .and_then(|store| store.get("tts_shortcut"))
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "Ctrl+Shift+R".to_string())
    };
    keyboard_hook::set_tts_key(0); // Onceki TTS hook'unu temizle
    if keyboard_hook::is_single_key(&tts_shortcut) {
        if let Some(vk) = keyboard_hook::key_name_to_vk(&tts_shortcut) {
            keyboard_hook::set_tts_key(vk);
        }
    } else {
        register_tts_shortcut(&app, &tts_shortcut).ok();
    }

    Ok(())
}

/// Windows UI Automation ile odaklanmis uygulamadan secili metni dogrudan al
/// Ctrl+C simülasyonuna gerek kalmadan, clipboard kirletmeden, aninda calisir
#[cfg(target_os = "windows")]
fn get_selected_text_uia() -> Option<String> {
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize,
        CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationTextPattern,
        IUIAutomationTextPattern2, UIA_TextPatternId, UIA_TextPattern2Id,
    };

    unsafe {
        // Bu thread icin COM baslat
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let result = (|| -> Option<String> {
            // UIAutomation COM nesnesi olustur
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL).ok()?;

            // Odaklanmis (focused) UI elementini al
            let element = automation.GetFocusedElement().ok()?;

            // Element hakkinda bilgi logla
            let name = element.CurrentName().unwrap_or_default();
            let ctrl_type = element.CurrentControlType().unwrap_or_default();
            eprintln!("[uia] Focused element: name='{}', controlType={}", name, ctrl_type.0);

            // Yontem 1: TextPattern2 dene (daha modern, daha genis destek)
            if let Ok(pattern_unk) = element.GetCurrentPattern(UIA_TextPattern2Id) {
                // Null pointer kontrolu — raw pointer'i kontrol et
                let raw: *mut std::ffi::c_void = std::mem::transmute_copy(&pattern_unk);
                if !raw.is_null() {
                    if let Ok(text_pattern) = pattern_unk.cast::<IUIAutomationTextPattern2>() {
                        if let Ok(ranges) = text_pattern.GetSelection() {
                            let count = ranges.Length().unwrap_or(0);
                            if count > 0 {
                                let mut selected = String::new();
                                for i in 0..count {
                                    if let Ok(range) = ranges.GetElement(i) {
                                        if let Ok(bstr) = range.GetText(-1) {
                                            selected.push_str(&bstr.to_string());
                                        }
                                    }
                                }
                                if !selected.trim().is_empty() {
                                    eprintln!("[uia] TextPattern2 ile metin alindi: {} karakter", selected.len());
                                    return Some(selected);
                                }
                            }
                        }
                    }
                }
            }

            // Yontem 2: TextPattern dene (klasik)
            if let Ok(pattern_unk) = element.GetCurrentPattern(UIA_TextPatternId) {
                let raw: *mut std::ffi::c_void = std::mem::transmute_copy(&pattern_unk);
                if !raw.is_null() {
                    if let Ok(text_pattern) = pattern_unk.cast::<IUIAutomationTextPattern>() {
                        if let Ok(ranges) = text_pattern.GetSelection() {
                            let count = ranges.Length().unwrap_or(0);
                            if count > 0 {
                                let mut selected = String::new();
                                for i in 0..count {
                                    if let Ok(range) = ranges.GetElement(i) {
                                        if let Ok(bstr) = range.GetText(-1) {
                                            selected.push_str(&bstr.to_string());
                                        }
                                    }
                                }
                                if !selected.trim().is_empty() {
                                    eprintln!("[uia] TextPattern ile metin alindi: {} karakter", selected.len());
                                    return Some(selected);
                                }
                            }
                        }
                    }
                }
            }

            eprintln!("[uia] Hicbir TextPattern desteklenmiyor");
            None
        })();

        CoUninitialize();
        result
    }
}

/// TTS kisayolu tetiklendiginde secili metni alip seslendiren mantik
/// Hem global shortcut handler'dan hem de keyboard hook'tan cagirilir
pub(crate) fn trigger_tts_read(app: tauri::AppHandle) {
    // Adim 1: UI Automation ile secili metni dogrudan al (anlik, clipboard kirletmez)
    #[cfg(target_os = "windows")]
    let uia_text = get_selected_text_uia();
    #[cfg(not(target_os = "windows"))]
    let uia_text: Option<String> = None;

    let text = if let Some(t) = uia_text {
        eprintln!("[tts-shortcut] UIA ile metin alindi: {} karakter", t.len());
        t
    } else {
        eprintln!("[tts-shortcut] UIA basarisiz, clipboard fallback...");

        // Clipboard'u temizle (eski icerigin okunmasini onle)
        if let Ok(mut cb) = arboard::Clipboard::new() {
            cb.set_text(String::new()).ok();
        }
        std::thread::sleep(std::time::Duration::from_millis(30));

        // Adim 2: WM_COPY ile kopyala (dogrudan kontrol mesaji, daha guvenilir)
        copy_via_wm_copy();

        // Clipboard'un dolmasini bekle
        let mut result = String::new();
        for attempt in 0..8 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            if let Ok(mut cb) = arboard::Clipboard::new() {
                if let Ok(txt) = cb.get_text() {
                    if !txt.trim().is_empty() {
                        result = txt;
                        eprintln!("[tts-shortcut] WM_COPY: clipboard {}ms'de doldu", (attempt + 1) * 50);
                        break;
                    }
                }
            }
        }

        // Adim 3: WM_COPY basarisiz ise SendInput Ctrl+C dene
        if result.trim().is_empty() {
            eprintln!("[tts-shortcut] WM_COPY basarisiz, SendInput Ctrl+C deneniyor...");
            simulate_ctrl_c();
            for attempt in 0..8 {
                std::thread::sleep(std::time::Duration::from_millis(50));
                if let Ok(mut cb) = arboard::Clipboard::new() {
                    if let Ok(txt) = cb.get_text() {
                        if !txt.trim().is_empty() {
                            result = txt;
                            eprintln!("[tts-shortcut] SendInput: clipboard {}ms'de doldu", (attempt + 1) * 50);
                            break;
                        }
                    }
                }
            }
        }

        result
    };

    if text.trim().is_empty() {
        eprintln!("[tts-shortcut] Metin alinamadi (UIA + Ctrl+C fallback bos)");
        return;
    }

    eprintln!("[tts-shortcut] {} karakter seslendiriliyor...", text.len());
    if let Some(window) = app.get_webview_window("main") {
        window.emit("tts-speak-text", &text).ok();
    }
}

fn register_tts_shortcut(app_handle: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let app = app_handle.clone();
    app_handle.global_shortcut().on_shortcut(shortcut, move |_app, sc, event| {
        if SHORTCUTS_SUSPENDED.load(Ordering::Relaxed) { return; }
        if let tauri_plugin_global_shortcut::ShortcutState::Pressed = event.state {
            log::info!("TTS kisayol basildi: {:?}", sc);
            let app_clone = app.clone();
            std::thread::spawn(move || {
                trigger_tts_read(app_clone);
            });
        }
    }).map_err(|e| format!("{}", e))
}

/// WM_COPY mesaji ile kopyalama — SendInput'tan daha guvenilir
/// Dogrudan odaklanmis kontrole mesaj gonderir, klavye durumuna bagimli degil
fn copy_via_wm_copy() -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        extern "system" {
            fn GetForegroundWindow() -> isize;
            fn GetFocus() -> isize;
            fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
            fn AttachThreadInput(attach: u32, to: u32, flag: i32) -> i32;
            fn GetCurrentThreadId() -> u32;
            fn SendMessageW(hwnd: isize, msg: u32, wp: usize, lp: isize) -> isize;
        }
        const WM_COPY: u32 = 0x0301;

        let fg = GetForegroundWindow();
        if fg == 0 {
            eprintln!("[copy] Foreground window bulunamadi");
            return false;
        }

        let mut fg_pid: u32 = 0;
        let fg_tid = GetWindowThreadProcessId(fg, &mut fg_pid);
        let our_tid = GetCurrentThreadId();

        // Thread input'u bagla — odaklanmis kontrolu alabilmek icin
        let attached = if fg_tid != our_tid {
            AttachThreadInput(our_tid, fg_tid, 1) != 0
        } else {
            false
        };

        let focused = GetFocus();

        if attached {
            AttachThreadInput(our_tid, fg_tid, 0); // ayir
        }

        // WM_COPY'yi odaklanmis kontrole veya ana pencereye gonder
        let target = if focused != 0 { focused } else { fg };
        eprintln!("[copy] WM_COPY gonderiliyor: target={}, foreground={}, focused={}", target, fg, focused);
        SendMessageW(target, WM_COPY, 0, 0);
        true
    }
    #[cfg(not(target_os = "windows"))]
    false
}

/// SendInput ile Ctrl+C simule et (WM_COPY fallback)
fn simulate_ctrl_c() {
    #[cfg(target_os = "windows")]
    unsafe {
        extern "system" {
            fn SendInput(count: u32, inputs: *const u8, size: i32) -> u32;
        }

        const VK_CONTROL: u16 = 0x11;
        const VK_SHIFT: u16 = 0x10;
        const VK_MENU: u16 = 0x12;
        const VK_C: u16 = 0x43;
        const KEYEVENTF_KEYUP: u32 = 0x0002;
        const INPUT_SIZE: i32 = 40;

        fn key_event(vk: u16, flags: u32) -> [u8; 40] {
            let mut buf = [0u8; 40];
            buf[0] = 1; // INPUT_KEYBOARD
            buf[8] = (vk & 0xFF) as u8;
            buf[9] = (vk >> 8) as u8;
            buf[12] = (flags & 0xFF) as u8;
            buf[13] = ((flags >> 8) & 0xFF) as u8;
            buf
        }

        eprintln!("[copy] Ctrl+C simule ediliyor (SendInput fallback)...");

        // Modifier tuslari birak
        let mut release = [0u8; 120];
        release[..40].copy_from_slice(&key_event(VK_SHIFT, KEYEVENTF_KEYUP));
        release[40..80].copy_from_slice(&key_event(VK_CONTROL, KEYEVENTF_KEYUP));
        release[80..120].copy_from_slice(&key_event(VK_MENU, KEYEVENTF_KEYUP));
        SendInput(3, release.as_ptr(), INPUT_SIZE);
        std::thread::sleep(std::time::Duration::from_millis(80));

        // Ctrl+C gonder
        let mut ctrl_c = [0u8; 160];
        ctrl_c[..40].copy_from_slice(&key_event(VK_CONTROL, 0));
        ctrl_c[40..80].copy_from_slice(&key_event(VK_C, 0));
        ctrl_c[80..120].copy_from_slice(&key_event(VK_C, KEYEVENTF_KEYUP));
        ctrl_c[120..160].copy_from_slice(&key_event(VK_CONTROL, KEYEVENTF_KEYUP));
        SendInput(4, ctrl_c.as_ptr(), INPUT_SIZE);
    }
}

fn setup_tts_shortcut(app_handle: &tauri::AppHandle) {
    let shortcut = {
        use tauri_plugin_store::StoreExt;
        app_handle.store("settings.json").ok()
            .and_then(|store| store.get("tts_shortcut"))
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "Ctrl+Shift+R".to_string())
    };

    if keyboard_hook::is_single_key(&shortcut) {
        // Tek tus — hook ile yakala
        if let Some(vk) = keyboard_hook::key_name_to_vk(&shortcut) {
            keyboard_hook::set_tts_key(vk);
            log::info!("TTS kisayol kaydedildi (hook): {} (vk={:#x})", shortcut, vk);
        } else {
            log::warn!("TTS: Bilinmeyen tus: {}, varsayilan Ctrl+Shift+R'ye donuluyor", shortcut);
            match register_tts_shortcut(app_handle, "Ctrl+Shift+R") {
                Ok(_) => log::info!("TTS varsayilan kisayol kaydedildi: Ctrl+Shift+R"),
                Err(e) => log::warn!("TTS varsayilan kisayol kaydedilemedi: {}", e),
            }
        }
    } else {
        // Modifier kombinasyonu — global shortcut ile yakala
        match register_tts_shortcut(app_handle, &shortcut) {
            Ok(_) => log::info!("TTS kisayol kaydedildi (global): {}", shortcut),
            Err(e) => log::warn!("TTS kisayol kaydedilemedi: {}", e),
        }
    }
}

#[tauri::command]
fn change_tts_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    // Mevcut ana kisayolu oku
    let main_shortcut = {
        use tauri_plugin_store::StoreExt;
        app.store("settings.json").ok()
            .and_then(|store| store.get("shortcut"))
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "Ctrl+Shift+Space".to_string())
    };

    // Global shortcut'lari temizle (hook haric)
    app.global_shortcut().unregister_all()
        .map_err(|e| format!("Kisayollar kaldirilamadi: {}", e))?;

    // Hook'un TTS tusunu sifirla
    keyboard_hook::set_tts_key(0);

    // Ana kisayolu tekrar kaydet (hook veya global'e gore)
    if keyboard_hook::is_single_key(&main_shortcut) {
        if let Some(vk) = keyboard_hook::key_name_to_vk(&main_shortcut) {
            keyboard_hook::set_key(vk);
        }
    } else {
        register_shortcut(&app, &main_shortcut).ok();
    }

    // Yeni TTS kisayolunu kaydet
    if keyboard_hook::is_single_key(&shortcut) {
        let vk = keyboard_hook::key_name_to_vk(&shortcut)
            .ok_or_else(|| format!("Bilinmeyen tus: {}", shortcut))?;
        keyboard_hook::set_tts_key(vk);
        log::info!("TTS kisayol degistirildi (hook): {} (vk={:#x})", shortcut, vk);
        Ok(())
    } else {
        match register_tts_shortcut(&app, &shortcut) {
            Ok(_) => {
                log::info!("TTS kisayol degistirildi (global): {}", shortcut);
                Ok(())
            }
            Err(e) => {
                log::warn!("Yeni TTS kisayol atanamadi: {}", e);
                Err(format!("Gecersiz kisayol: {}. Gecerli ornek: Ctrl+Shift+R, F6, Alt+R", shortcut))
            }
        }
    }
}

// ─── Edge TTS Tauri Komutlari ───

#[tauri::command]
async fn edge_tts_get_voices() -> Result<Vec<edge_tts::EdgeVoice>, String> {
    eprintln!("[tauri-cmd] edge_tts_get_voices cagirildi");
    let result = edge_tts::fetch_voices().await;
    match &result {
        Ok(voices) => eprintln!("[tauri-cmd] {} ses donduruldu", voices.len()),
        Err(e) => eprintln!("[tauri-cmd] Ses listesi hatasi: {}", e),
    }
    result
}

#[tauri::command]
async fn edge_tts_synthesize(
    text: String,
    voice: String,
    rate: f64,
    pitch: f64,
    volume: f64,
) -> Result<String, String> {
    eprintln!("[tauri-cmd] edge_tts_synthesize cagirildi: voice={}, len={}", voice, text.len());
    let audio = edge_tts::synthesize(&text, &voice, rate, pitch, volume).await?;
    eprintln!("[tauri-cmd] Sentez tamamlandi, {} byte audio", audio.len());
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&audio))
}
