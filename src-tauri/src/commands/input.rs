use enigo::{Enigo, Keyboard, Settings};
use std::sync::atomic::{AtomicIsize, Ordering};

/// Son aktif (bizim olmayan) pencere HWND'si (yedek)
static LAST_FOREGROUND_HWND: AtomicIsize = AtomicIsize::new(0);

#[cfg(target_os = "windows")]
extern "system" {
    fn GetForegroundWindow() -> isize;
    fn SetForegroundWindow(hwnd: isize) -> i32;
    fn GetWindowThreadProcessId(hwnd: isize, process_id: *mut u32) -> u32;
    fn GetCurrentProcessId() -> u32;
    fn keybd_event(bvk: u8, bscan: u8, dwflags: u32, dwextrainfo: usize);
    fn AttachThreadInput(idattach: u32, idattachto: u32, fattach: i32) -> i32;
    fn GetCurrentThreadId() -> u32;
    fn GetCursorPos(point: *mut Point) -> i32;
    fn WindowFromPoint(point: Point) -> isize;
    fn GetAncestor(hwnd: isize, flags: u32) -> isize;
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Copy, Clone)]
struct Point {
    x: i32,
    y: i32,
}

#[cfg(target_os = "windows")]
const GA_ROOT: u32 = 2;

/// Verilen HWND bizim uygulamamiza mi ait?
#[cfg(target_os = "windows")]
fn is_our_window(hwnd: isize) -> bool {
    unsafe {
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        pid == GetCurrentProcessId()
    }
}

/// Son kaydedilen foreground pencere HWND'sini dondurur (UIA read-along icin)
pub fn get_last_foreground_hwnd() -> isize {
    LAST_FOREGROUND_HWND.load(Ordering::SeqCst)
}

/// Dahili fonksiyon - sadece bizim olmayan pencereleri kaydet
pub fn save_foreground_internal() {
    #[cfg(target_os = "windows")]
    {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd != 0 && !is_our_window(hwnd) {
            LAST_FOREGROUND_HWND.store(hwnd, Ordering::SeqCst);
            log::info!("Harici pencere kaydedildi: HWND={}", hwnd);
        }
    }
}

/// Aktif pencereyi kaydet (frontend'den cagrilir)
#[tauri::command]
pub fn save_foreground_window() {
    save_foreground_internal();
}

/// Kaydedilen pencereyi on plana getir
#[tauri::command]
pub fn restore_foreground_window() {
    let hwnd = LAST_FOREGROUND_HWND.load(Ordering::SeqCst);
    activate_window(hwnd);
}

/// Mouse imlecinin altindaki ust-seviye pencereyi bul
#[cfg(target_os = "windows")]
fn get_window_under_cursor() -> isize {
    unsafe {
        let mut cursor_pos = Point { x: 0, y: 0 };
        if GetCursorPos(&mut cursor_pos) == 0 {
            return 0;
        }
        let child = WindowFromPoint(cursor_pos);
        if child == 0 {
            return 0;
        }
        // Ust-seviye (root) pencereyi al
        let root = GetAncestor(child, GA_ROOT);
        if root != 0 { root } else { child }
    }
}

/// Yapistirma hedef penceresi belirle:
/// 1. Mouse imlecinin altindaki pencere (bizim degilse)
/// 2. Fallback: kisayol basildiginda kaydedilen pencere
#[cfg(target_os = "windows")]
fn find_paste_target() -> isize {
    // Oncelik 1: Mouse'un altindaki pencere
    let under_cursor = get_window_under_cursor();
    if under_cursor != 0 && !is_our_window(under_cursor) {
        log::info!("Hedef: mouse altindaki pencere HWND={}", under_cursor);
        return under_cursor;
    }

    // Oncelik 2: Kisayol basildiginda kaydedilen pencere
    let saved = LAST_FOREGROUND_HWND.load(Ordering::SeqCst);
    if saved != 0 {
        log::info!("Hedef: kaydedilmis pencere HWND={}", saved);
        return saved;
    }

    log::warn!("Hedef pencere bulunamadi");
    0
}

/// Belirli bir pencereyi on plana getir (retry ile)
fn activate_window(hwnd: isize) {
    #[cfg(target_os = "windows")]
    {
        if hwnd == 0 {
            return;
        }

        for attempt in 0..2 {
            unsafe {
                let our_thread = GetCurrentThreadId();
                let target_thread = GetWindowThreadProcessId(hwnd, std::ptr::null_mut());

                if our_thread != target_thread {
                    AttachThreadInput(our_thread, target_thread, 1);
                }

                keybd_event(0x12, 0, 0, 0); // Alt down
                SetForegroundWindow(hwnd);
                keybd_event(0x12, 0, 2, 0); // Alt up

                if our_thread != target_thread {
                    AttachThreadInput(our_thread, target_thread, 0);
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(80));

            let current = unsafe { GetForegroundWindow() };
            if current == hwnd {
                log::info!("Pencere aktif edildi (deneme {}): HWND={}", attempt + 1, hwnd);
                return;
            }

            if attempt == 0 {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }

        log::warn!("Pencere aktif edilemedi: HWND={}", hwnd);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = hwnd;
    }
}

/// Metni panoya kopyalayip aktif uygulamaya yapistir (Ctrl+V)
/// Mouse imlecinin altindaki pencereye yapistirma yapar.
/// Fallback olarak kisayol basildiginda kaydedilen pencereyi kullanir.
#[tauri::command]
pub fn paste_to_active_app(text: String) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }

    // Hedef pencereyi belirle ve aktif et
    #[cfg(target_os = "windows")]
    {
        let target = find_paste_target();
        if target != 0 {
            let current = unsafe { GetForegroundWindow() };
            if current != target {
                activate_window(target);
            }
        }
    }

    // Clipboard'a yaz
    use arboard::Clipboard;
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("Pano acilamadi: {}", e))?;
    clipboard.set_text(&text)
        .map_err(|e| format!("Panoya yazilamadi: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(100));

    // Modifier tuslarin serbest oldugundan emin ol
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Enigo baslatilamadi: {}", e))?;

    enigo.key(enigo::Key::Shift, enigo::Direction::Release).ok();
    enigo.key(enigo::Key::Control, enigo::Direction::Release).ok();
    enigo.key(enigo::Key::Alt, enigo::Direction::Release).ok();

    std::thread::sleep(std::time::Duration::from_millis(30));

    // Ctrl+V ile yapistir
    enigo.key(enigo::Key::Control, enigo::Direction::Press)
        .map_err(|e| format!("Ctrl basilamadi: {}", e))?;
    enigo.key(enigo::Key::Unicode('v'), enigo::Direction::Click)
        .map_err(|e| format!("V basilamadi: {}", e))?;
    enigo.key(enigo::Key::Control, enigo::Direction::Release)
        .map_err(|e| format!("Ctrl birakilamadi: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(50));

    log::info!("Metin yapistrildi: {} karakter", text.len());
    Ok(())
}
