// Yerel ag uzerinde mobil tarayici icin hafif HTTP sunucu
// Telefon tarayicisi bu sunucuya baglanarak canli transkripsiyonu gorebilir

use axum::{Router, response::Html, routing::get};
use parking_lot::Mutex as ParkingMutex;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::oneshot;

static COLLAB_HTML: &str = include_str!("../assets/collab.html");

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static SERVER_INFO: ParkingMutex<Option<CollabServerInfo>> = ParkingMutex::new(None);
static SHUTDOWN_TX: ParkingMutex<Option<oneshot::Sender<()>>> = ParkingMutex::new(None);

#[derive(Debug, Clone, Serialize)]
pub struct CollabServerInfo {
    pub url: String,
    pub port: u16,
    pub local_ip: String,
}

#[tauri::command]
pub async fn start_collab_server(peer_id: String) -> Result<CollabServerInfo, String> {
    if SERVER_RUNNING.load(Ordering::SeqCst) {
        // Zaten calisiyorsa mevcut bilgiyi dondur
        if let Some(info) = SERVER_INFO.lock().clone() {
            return Ok(info);
        }
    }

    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    let pid = peer_id.clone();
    let html_content = COLLAB_HTML.replace("{{PEER_ID}}", &pid);

    let app = Router::new().route(
        "/",
        get(move || {
            let html = html_content.clone();
            async move { Html(html) }
        }),
    );

    let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Sunucu baslatilamadi: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Port alinamadi: {}", e))?
        .port();

    let url = format!("http://{}:{}/?peer={}", local_ip, port, peer_id);

    let info = CollabServerInfo {
        url: url.clone(),
        port,
        local_ip: local_ip.clone(),
    };

    let (tx, rx) = oneshot::channel::<()>();

    *SHUTDOWN_TX.lock() = Some(tx);
    SERVER_RUNNING.store(true, Ordering::SeqCst);
    *SERVER_INFO.lock() = Some(info.clone());

    // Sunucuyu arka planda calistir
    tokio::spawn(async move {
        let server = axum::serve(listener, app);
        let graceful = server.with_graceful_shutdown(async {
            rx.await.ok();
        });
        if let Err(e) = graceful.await {
            log::error!("Collab HTTP sunucu hatasi: {}", e);
        }
        SERVER_RUNNING.store(false, Ordering::SeqCst);
        *SERVER_INFO.lock() = None;
        log::info!("Collab HTTP sunucu durduruldu");
    });

    log::info!("Collab HTTP sunucu baslatildi: {}", url);
    Ok(info)
}

#[tauri::command]
pub async fn stop_collab_server() -> Result<(), String> {
    if let Some(tx) = SHUTDOWN_TX.lock().take() {
        tx.send(()).ok();
    }
    SERVER_RUNNING.store(false, Ordering::SeqCst);
    *SERVER_INFO.lock() = None;
    Ok(())
}

#[tauri::command]
pub async fn get_collab_server_info() -> Result<Option<CollabServerInfo>, String> {
    Ok(SERVER_INFO.lock().clone())
}
