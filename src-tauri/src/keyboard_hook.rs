//! Dusuk seviyeli klavye hook'u — push-to-talk icin tek tus destegi.
//!
//! Windows WH_KEYBOARD_LL hook kullanarak herhangi bir tusu push-to-talk
//! kisayolu olarak kaydeder. RegisterHotKey'den farkli olarak:
//! - Herhangi bir tek tus destekler (A, F5, CapsLock, vb.)
//! - Sadece basildiginda bastirir (diger tuslar etkilenmez)
//! - Press/Release algilama guvenilir

#[cfg(target_os = "windows")]
mod win {
    use std::sync::atomic::{AtomicU32, AtomicBool, AtomicIsize, Ordering};
    use std::sync::OnceLock;
    use tauri::{Emitter, Manager};

    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW,
        SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx,
        HHOOK, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_QUIT,
    };

    static HOOK_HANDLE: AtomicIsize = AtomicIsize::new(0);
    static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
    static TARGET_VK: AtomicU32 = AtomicU32::new(0);
    static KEY_IS_DOWN: AtomicBool = AtomicBool::new(false);
    /// TTS kisayolu icin hedef VK kodu (0 = devre disi)
    static TTS_TARGET_VK: AtomicU32 = AtomicU32::new(0);
    static TTS_KEY_IS_DOWN: AtomicBool = AtomicBool::new(false);
    static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

    // WM_ sabitleri
    const WM_KEYDOWN_U: u32 = 0x0100;
    const WM_KEYUP_U: u32 = 0x0101;
    const WM_SYSKEYDOWN_U: u32 = 0x0104;
    const WM_SYSKEYUP_U: u32 = 0x0105;

    unsafe extern "system" fn ll_keyboard_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code >= 0 {
            let kbd = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let suspended = crate::SHORTCUTS_SUSPENDED.load(Ordering::Relaxed);
            let msg = wparam.0 as u32;
            let is_down = msg == WM_KEYDOWN_U || msg == WM_SYSKEYDOWN_U;
            let is_up = msg == WM_KEYUP_U || msg == WM_SYSKEYUP_U;

            // --- STT kisayolu (push-to-talk) ---
            let target = TARGET_VK.load(Ordering::Relaxed);
            if target != 0 && kbd.vkCode == target && !suspended {
                if is_down && !KEY_IS_DOWN.load(Ordering::Relaxed) {
                    KEY_IS_DOWN.store(true, Ordering::Relaxed);
                    if let Some(app) = APP_HANDLE.get() {
                        crate::commands::input::save_foreground_internal();
                        if let Some(w) = app.get_webview_window("overlay") {
                            let _ = w.show();
                            let _ = w.emit("shortcut-key-down", "");
                        }
                    }
                    return LRESULT(1);
                }
                if is_down { return LRESULT(1); } // Key repeat
                if is_up {
                    KEY_IS_DOWN.store(false, Ordering::Relaxed);
                    if let Some(app) = APP_HANDLE.get() {
                        if let Some(w) = app.get_webview_window("overlay") {
                            let _ = w.emit("shortcut-key-up", "");
                        }
                    }
                    return LRESULT(1);
                }
            }

            // --- TTS kisayolu (tek basin = secili metni seslendir) ---
            let tts_target = TTS_TARGET_VK.load(Ordering::Relaxed);
            if tts_target != 0 && kbd.vkCode == tts_target && !suspended {
                if is_down && !TTS_KEY_IS_DOWN.load(Ordering::Relaxed) {
                    TTS_KEY_IS_DOWN.store(true, Ordering::Relaxed);
                    if let Some(app) = APP_HANDLE.get() {
                        let app_clone = app.clone();
                        std::thread::spawn(move || {
                            crate::trigger_tts_read(app_clone);
                        });
                    }
                    return LRESULT(1);
                }
                if is_down { return LRESULT(1); } // Key repeat
                if is_up {
                    TTS_KEY_IS_DOWN.store(false, Ordering::Relaxed);
                    return LRESULT(1);
                }
            }
        }

        unsafe {
            CallNextHookEx(
                HHOOK(HOOK_HANDLE.load(Ordering::Relaxed) as _),
                code,
                wparam,
                lparam,
            )
        }
    }

    /// Hook'u kur (uygulama baslandiginda bir kez cagrilir)
    pub fn install(app: tauri::AppHandle) {
        let _ = APP_HANDLE.set(app);
        uninstall();

        std::thread::Builder::new()
            .name("keyboard-hook".into())
            .spawn(move || unsafe {
                use windows::Win32::System::Threading::GetCurrentThreadId;

                let tid = GetCurrentThreadId();
                HOOK_THREAD_ID.store(tid, Ordering::Relaxed);

                let hook = SetWindowsHookExW(
                    WH_KEYBOARD_LL,
                    Some(ll_keyboard_proc),
                    HINSTANCE::default(),
                    0,
                );

                match hook {
                    Ok(h) => {
                        HOOK_HANDLE.store(h.0 as isize, Ordering::Relaxed);
                        eprintln!("[keyboard_hook] Hook kuruldu, thread_id={}", tid);

                        // Mesaj pompasi — LL hook icin gerekli
                        let mut msg = MSG::default();
                        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                            let _ = TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                        }

                        let h = HOOK_HANDLE.swap(0, Ordering::Relaxed);
                        if h != 0 {
                            let _ = UnhookWindowsHookEx(HHOOK(h as _));
                        }
                        eprintln!("[keyboard_hook] Hook thread sonlandi");
                    }
                    Err(e) => {
                        eprintln!("[keyboard_hook] SetWindowsHookExW basarisiz: {}", e);
                    }
                }
            })
            .ok();
    }

    /// STT hedef tusunu degistir (VK kodu). 0 = devre disi.
    pub fn set_key(vk_code: u32) {
        eprintln!("[keyboard_hook] STT hedef tus degisti: vk={:#x}", vk_code);
        TARGET_VK.store(vk_code, Ordering::Relaxed);
        KEY_IS_DOWN.store(false, Ordering::Relaxed);
    }

    /// TTS hedef tusunu degistir (VK kodu). 0 = devre disi.
    pub fn set_tts_key(vk_code: u32) {
        eprintln!("[keyboard_hook] TTS hedef tus degisti: vk={:#x}", vk_code);
        TTS_TARGET_VK.store(vk_code, Ordering::Relaxed);
        TTS_KEY_IS_DOWN.store(false, Ordering::Relaxed);
    }

    /// Hook'u kaldir
    pub fn uninstall() {
        let h = HOOK_HANDLE.swap(0, Ordering::Relaxed);
        if h != 0 {
            unsafe {
                let _ = UnhookWindowsHookEx(HHOOK(h as _));
            }
        }

        let tid = HOOK_THREAD_ID.swap(0, Ordering::Relaxed);
        if tid != 0 {
            unsafe {
                let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        }

        KEY_IS_DOWN.store(false, Ordering::Relaxed);
    }
}

#[cfg(target_os = "windows")]
pub use win::*;

#[cfg(not(target_os = "windows"))]
pub fn install(_app: tauri::AppHandle) {}
#[cfg(not(target_os = "windows"))]
pub fn set_key(_vk: u32) {}
#[cfg(not(target_os = "windows"))]
pub fn set_tts_key(_vk: u32) {}
#[cfg(not(target_os = "windows"))]
pub fn uninstall() {}

/// Kisayol stringi tek tus mu (modifier yok)?
pub fn is_single_key(shortcut: &str) -> bool {
    !shortcut.contains('+')
}

/// Tus isminden Windows VK kodunu dondurur
pub fn key_name_to_vk(name: &str) -> Option<u32> {
    // Tek karakter — harf veya rakam
    if name.len() == 1 {
        let ch = name.chars().next().unwrap();
        if ch.is_ascii_uppercase() {
            return Some(ch as u32);
        }
        if ch.is_ascii_digit() {
            return Some(ch as u32);
        }
    }

    // F tuslari (F1-F24)
    if let Some(n) = name.strip_prefix('F') {
        if let Ok(num) = n.parse::<u32>() {
            if (1..=24).contains(&num) {
                return Some(0x6F + num); // F1=0x70
            }
        }
    }

    match name {
        "Space" => Some(0x20),
        "Tab" => Some(0x09),
        "Enter" => Some(0x0D),
        "Escape" => Some(0x1B),
        "Backspace" => Some(0x08),
        "Delete" => Some(0x2E),
        "Insert" => Some(0x2D),
        "Home" => Some(0x24),
        "End" => Some(0x23),
        "PageUp" | "PAGEUP" => Some(0x21),
        "PageDown" | "PAGEDOWN" => Some(0x22),
        "Up" | "UP" => Some(0x26),
        "Down" | "DOWN" => Some(0x28),
        "Left" | "LEFT" => Some(0x25),
        "Right" | "RIGHT" => Some(0x27),
        "CapsLock" | "CAPSLOCK" => Some(0x14),
        "NumLock" | "NUMLOCK" => Some(0x90),
        "ScrollLock" | "SCROLLLOCK" => Some(0x91),
        "Pause" | "PAUSE" => Some(0x13),
        "PrintScreen" | "PRINTSCREEN" => Some(0x2C),
        "ContextMenu" | "CONTEXTMENU" => Some(0x5D),
        "Numpad0" => Some(0x60),
        "Numpad1" => Some(0x61),
        "Numpad2" => Some(0x62),
        "Numpad3" => Some(0x63),
        "Numpad4" => Some(0x64),
        "Numpad5" => Some(0x65),
        "Numpad6" => Some(0x66),
        "Numpad7" => Some(0x67),
        "Numpad8" => Some(0x68),
        "Numpad9" => Some(0x69),
        _ => None,
    }
}
