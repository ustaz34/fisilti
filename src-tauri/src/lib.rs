mod audio;
mod commands;
mod corrections;
mod model;
mod settings;
mod text;
mod transcription;

use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

/// Overlay penceresinin Win32 HWND'si (setup_overlay_win32 tarafindan set edilir)
static OVERLAY_HWND: AtomicIsize = AtomicIsize::new(0);
/// Overlay'in orijinal WndProc'u (subclassing icin)
static ORIGINAL_WNDPROC: AtomicIsize = AtomicIsize::new(0);
/// Overlay'in imleci takip edip etmeyecegi
static OVERLAY_FOLLOW_CURSOR: AtomicBool = AtomicBool::new(true);
/// Overlay bar'in aktif durumu (recording veya transcribing = true)
static OVERLAY_BAR_ACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
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
            let quit_item = MenuItemBuilder::with_id("quit", "Çıkış")
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_item)
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

            // Overlay penceresi - baslik temizle, konumlandir, goster
            if let Some(window) = app.get_webview_window("overlay") {
                window.set_title("").ok();
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
            show_main_window,
            hide_main_window,
            change_shortcut,
            set_overlay_follow_cursor,
            set_overlay_bar_active,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri uygulamasi baslatilirken hata olustu");
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
        const GWLP_WNDPROC: i32 = -4;
        const WS_EX_NOACTIVATE: isize = 0x08000000;
        const WS_EX_TOOLWINDOW: isize = 0x00000080;
        const WM_DPICHANGED: u32 = 0x02E0;
        const WM_NCHITTEST: u32 = 0x0084;
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

                // Hit area: bar her zaman alt-ortada
                // Aktif (kayit/donusum): genis alan
                // Idle: sadece kucuk centik alani
                let (x_min, x_max, y_min) = if is_active {
                    // Recording/transcribing: center %90, bottom %92
                    (0.05, 0.95, 0.08)
                } else {
                    // Idle: center %30, bottom %80 (centik + hover padding)
                    (0.35, 0.65, 0.80)
                };

                if rx >= x_min && rx <= x_max && ry >= y_min {
                    // Bar alaninda — normal hit test
                    let orig = ORIGINAL_WNDPROC.load(Ordering::Acquire);
                    if orig != 0 {
                        return CallWindowProcW(orig, hwnd, msg, wp, lp);
                    } else {
                        return DefWindowProcW(hwnd, msg, wp, lp);
                    }
                }

                // Seffaf alan — tiklamalar altindaki pencereye gecsin
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

        unsafe {
            let pid = GetCurrentProcessId();
            EnumWindows(enum_cb, pid as isize);
        }

        let hwnd = OVERLAY_HWND.load(Ordering::Acquire);
        if hwnd == 0 {
            eprintln!("[fisilti] HATA: Overlay HWND bulunamadi!");
            return;
        }

        // Adim 2: Stilleri ve subclassing'i uygula (enum_cb disinda)
        unsafe {
            // Subclass: once orig'i kaydet, sonra set et
            let orig = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, overlay_wndproc as isize);
            ORIGINAL_WNDPROC.store(orig, Ordering::Release);
            eprintln!("[fisilti] WndProc subclass uygulandi, orig={}", orig);

            // WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);

            // NOT: WS_POPUP ve SWP_FRAMECHANGED KULLANILMIYOR
            // Tauri'nin decorations:false zaten dekorasyonlari kaldiriyor.
            // WS_POPUP + SWP_FRAMECHANGED Tauri'nin seffaflik mekanizmasini bozuyordu.

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

    match register_shortcut(app_handle, &shortcut) {
        Ok(_) => log::info!("Global kisayol kaydedildi: {}", shortcut),
        Err(e) => log::warn!("Global kisayol kaydedilemedi: {}", e),
    }
}

#[tauri::command]
fn set_overlay_follow_cursor(enabled: bool) {
    OVERLAY_FOLLOW_CURSOR.store(enabled, Ordering::Relaxed);
    log::info!("Overlay follow cursor: {}", enabled);
}

#[tauri::command]
fn set_overlay_bar_active(active: bool) {
    OVERLAY_BAR_ACTIVE.store(active, Ordering::Relaxed);
}

#[tauri::command]
fn change_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    // Eski kisayolu oku (basarisiz olursa geri yuklemek icin)
    let old_shortcut = {
        use tauri_plugin_store::StoreExt;
        app.store("settings.json").ok()
            .and_then(|store| store.get("shortcut"))
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "Ctrl+Shift+Space".to_string())
    };

    // Tum mevcut kisayollari kaldir
    app.global_shortcut().unregister_all()
        .map_err(|e| format!("Kisayollar kaldirilamadi: {}", e))?;

    // Yeni kisayolu kaydet, basarisiz olursa eski kisayola geri don
    match register_shortcut(&app, &shortcut) {
        Ok(_) => {
            log::info!("Kisayol degistirildi: {}", shortcut);
            Ok(())
        }
        Err(e) => {
            log::warn!("Yeni kisayol atanamadi ({}), eski kisayola donuluyor: {}", e, old_shortcut);
            register_shortcut(&app, &old_shortcut).ok();
            Err(format!("Gecersiz kisayol: {}. Gecerli ornek: Ctrl+Shift+Space, F5, Alt+A", shortcut))
        }
    }
}
