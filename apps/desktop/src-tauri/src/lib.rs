use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{Manager, RunEvent};

struct SidecarState(Mutex<Option<Child>>);

fn data_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|dir| PathBuf::from(dir).join("LaCasaDelShampoo"))
        .unwrap_or_else(|_| PathBuf::from("LaCasaDelShampoo"))
}

fn wait_for_api() -> bool {
    for _ in 0..50 {
        if TcpStream::connect_timeout(
            &"127.0.0.1:5100".parse().expect("dirección local"),
            Duration::from_millis(200),
        )
        .is_ok()
        {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let server_dir = resource_dir.join("server");
    let node = server_dir.join("node.exe");
    let entry = server_dir.join("index.js");
    if !node.is_file() || !entry.is_file() {
        return Err(
            "No está el servidor local. En desarrollo ejecute npm run dev:server.".into(),
        );
    }

    let data_dir = data_dir();
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("server.log"))
        .map_err(|e| e.to_string())?;
    let log_err = log_file.try_clone().map_err(|e| e.to_string())?;

    let mut command = Command::new(&node);
    command
        .arg(&entry)
        .current_dir(&server_dir)
        .env("LCDS_PORT", "5100")
        .env("LCDS_HOST", "127.0.0.1")
        .env("LCDS_DATA_DIR", &data_dir)
        .env("LCDS_PRINT_MODE", "simulate")
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command
        .spawn()
        .map_err(|e| format!("No se pudo iniciar el servidor: {e}"))?;

    let state = app.state::<SidecarState>();
    *state.0.lock().map_err(|e| e.to_string())? = Some(child);

    if !wait_for_api() {
        let mut log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(data_dir.join("server.log"))
            .map_err(|e| e.to_string())?;
        let _ = writeln!(log, "[LCDS] El servidor no abrió el puerto 5100.");
    }
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
