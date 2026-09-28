use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

struct SidecarState(Mutex<Option<Child>>);

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;

    let candidates = [
        resource_dir.join("binaries").join("lcds-server.exe"),
        resource_dir.join("binaries").join("lcds-server"),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("lcds-server.exe")))
            .unwrap_or_default(),
    ];

    let bin = candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| {
            "Sidecar lcds-server no encontrado. En desarrollo ejecute npm run dev:server."
                .to_string()
        })?;

    let child = Command::new(bin)
        .env("LCDS_PORT", "5100")
        .env("LCDS_HOST", "127.0.0.1")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar sidecar: {e}"))?;

    let state = app.state::<SidecarState>();
    *state.0.lock().map_err(|e| e.to_string())? = Some(child);
    Ok(())
}

fn kill_sidecar(app: &tauri::AppHandle) {
    if let Ok(mut guard) = app.state::<SidecarState>().0.lock() {
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
        }
        *guard = None;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                if let Err(err) = spawn_sidecar(app.handle()) {
                    eprintln!("[LCDS] {err}");
                }
            }
            let _ = spawn_sidecar;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error al construir Tauri")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                kill_sidecar(app_handle);
            }
        });
}
