use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, Manager};

const DRAFT_FILE: &str = "draft.txt";

#[derive(Serialize)]
struct Draft {
    text: String,
    /// 最終保存時刻（UNIX エポックからのミリ秒）。まだ一度も保存していなければ None
    saved_at: Option<u64>,
}

fn draft_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(DRAFT_FILE))
}

fn modified_millis(path: &Path) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?;
    let elapsed = modified.duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?;
    Ok(elapsed.as_millis() as u64)
}

#[tauri::command]
fn load_draft(app: AppHandle) -> Result<Draft, String> {
    let path = draft_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Draft {
            text,
            saved_at: Some(modified_millis(&path)?),
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Draft {
            text: String::new(),
            saved_at: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn save_draft(app: AppHandle, text: String) -> Result<u64, String> {
    let path = draft_path(&app)?;
    // 直接上書きすると書き込み途中で落ちたときに本文が消えるので、一時ファイルに書いてから rename で置き換える
    let tmp = path.with_extension("txt.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    modified_millis(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![load_draft, save_draft])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
