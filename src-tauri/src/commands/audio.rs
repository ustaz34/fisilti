use crate::audio::{self, AudioDevice, SharedAudioState};
use std::sync::OnceLock;

static AUDIO_STATE: OnceLock<SharedAudioState> = OnceLock::new();

fn get_state() -> &'static SharedAudioState {
    AUDIO_STATE.get_or_init(SharedAudioState::new)
}

// Stream'i thread-local olarak yonet (Send degil)
std::thread_local! {
    static STREAM: std::cell::RefCell<Option<cpal::Stream>> = const { std::cell::RefCell::new(None) };
}

#[tauri::command]
pub fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    Ok(audio::list_devices())
}

#[tauri::command]
pub fn start_recording(device_name: Option<String>) -> Result<(), String> {
    let state = get_state();
    let stream = audio::start_recording(state, device_name)?;
    STREAM.with(|s| {
        *s.borrow_mut() = Some(stream);
    });
    Ok(())
}

#[tauri::command]
pub fn stop_recording() -> Result<Vec<f32>, String> {
    STREAM.with(|s| {
        *s.borrow_mut() = None;
    });
    let state = get_state();
    audio::stop_recording(state)
}

#[tauri::command]
pub fn get_audio_levels() -> f32 {
    let state = get_state();
    audio::get_level(state)
}
