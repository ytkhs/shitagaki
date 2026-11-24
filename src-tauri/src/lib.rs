use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::window::Color;
use tauri::{AppHandle, Manager, RunEvent, State, Theme, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::StateFlags;

const DRAFT_FILE: &str = "draft.txt";
const THEME_FILE: &str = "theme.txt";

#[derive(Serialize)]
struct Draft {
    text: String,
    /// 最終保存時刻（UNIX エポックからのミリ秒）。まだ一度も保存していなければ None
    saved_at: Option<u64>,
}

fn data_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
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
    let path = data_path(&app, DRAFT_FILE)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Draft {
            text,
            saved_at: modified_millis(&path).ok(),
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Draft {
            text: String::new(),
            saved_at: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}

/// まだファイルに書いていない最新の本文。
/// 書き込みは入力が止まってからまとめて行うので、その前に終了されても最後の入力を失わないよう Rust 側で持っておく
#[derive(Default)]
struct PendingDraft(Mutex<Option<String>>);

fn write_draft_to(path: &Path, text: &str) -> Result<u64, String> {
    // 直接上書きすると書き込み途中で落ちたときに本文が消えるので、一時ファイルに書いてから rename で置き換える
    let tmp = path.with_extension("txt.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    modified_millis(path)
}

fn flush_pending<F>(pending: &PendingDraft, write: F) -> Result<Option<u64>, String>
where
    F: FnOnce(&str) -> Result<u64, String>,
{
    let mut guard = pending.0.lock().map_err(|e| e.to_string())?;
    let Some(text) = guard.as_deref() else {
        return Ok(None);
    };
    let saved_at = write(text)?;
    *guard = None;
    Ok(Some(saved_at))
}

/// 書いていない本文があればファイルに書き、書いたときだけその保存時刻を返す
fn flush_draft(app: &AppHandle) -> Result<Option<u64>, String> {
    let pending = app.state::<PendingDraft>();
    flush_pending(&pending, |text| {
        let path = data_path(app, DRAFT_FILE)?;
        write_draft_to(&path, text)
    })
}

#[tauri::command]
fn stage_draft(pending: State<PendingDraft>, text: String) -> Result<(), String> {
    *pending.0.lock().map_err(|e| e.to_string())? = Some(text);
    Ok(())
}

#[tauri::command]
fn save_draft(app: AppHandle) -> Result<Option<u64>, String> {
    flush_draft(&app)
}

fn load_theme(app: &AppHandle) -> Theme {
    let saved = data_path(app, THEME_FILE).and_then(|p| fs::read_to_string(p).map_err(|e| e.to_string()));
    match saved.as_deref().map(str::trim) {
        Ok("light") => Theme::Light,
        _ => Theme::Dark,
    }
}

#[tauri::command]
fn get_theme(app: AppHandle) -> &'static str {
    match load_theme(&app) {
        Theme::Light => "light",
        _ => "dark",
    }
}

#[tauri::command]
fn save_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let theme = if theme == "light" { "light" } else { "dark" };
    fs::write(data_path(&app, THEME_FILE)?, theme).map_err(|e| e.to_string())
}

/// macOS の WKWebView は実行中に背景色を変えても初回描画までに間に合わず、テーマと違う色が一瞬見える。
/// そのため保存済みのテーマを先に読み、ウィンドウを作る時点で明暗と下地の色を決めておく
fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    let theme = load_theme(app);
    let background = match theme {
        Theme::Light => Color(0xfb, 0xfb, 0xf9, 0xff),
        _ => Color(0x1e, 0x1f, 0x22, 0xff),
    };
    WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("shitagaki")
        .inner_size(520.0, 640.0)
        .min_inner_size(320.0, 200.0)
        .theme(Some(theme))
        .background_color(background)
        .visible(false)
        .build()?;
    Ok(())
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// どのアプリを使っていても shitagaki を前に出すキー（Mac は ⌃⌥S、Windows は Ctrl+Alt+S）
fn summon_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS)
}

pub fn run() {
    tauri::Builder::default()
        // 2 つ目のプロセスが同じ draft.txt に書くと互いの本文を上書きし合うので、起動済みならそちらを前に出して終わる
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        // 前回の表示状態まで戻すとテーマを当てる前にウィンドウが出てしまうので、表示はフロント側に任せる
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if *shortcut == summon_shortcut() && event.state() == ShortcutState::Pressed {
                        focus_main_window(app);
                    }
                })
                .build(),
        )
        .manage(PendingDraft::default())
        .setup(|app| {
            create_main_window(app.handle())?;
            // 他のアプリがすでに同じキーを使っていると登録できない。呼び出せないだけで書くことはできるので起動は続ける
            if let Err(e) = app.global_shortcut().register(summon_shortcut()) {
                eprintln!("global shortcut not registered: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_draft,
            stage_draft,
            save_draft,
            get_theme,
            save_theme
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event
                && let Err(e) = flush_draft(app)
            {
                eprintln!("failed to save draft on exit: {e}");
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIR_SEQ: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let seq = TEST_DIR_SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "shitagaki-test-{}-{}",
                std::process::id(),
                seq
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn flush_pending_skips_when_empty() {
        let pending = PendingDraft::default();
        let mut called = false;
        let res = flush_pending(&pending, |_| {
            called = true;
            Ok(123)
        });
        assert_eq!(res, Ok(None));
        assert!(!called);
    }

    #[test]
    fn flush_pending_retains_draft_on_error_and_clears_on_retry() {
        let pending = PendingDraft(Mutex::new(Some("unsaved text".to_string())));

        let err = flush_pending(&pending, |_| Err("disk busy".to_string()));
        assert_eq!(err, Err("disk busy".to_string()));
        assert_eq!(
            pending.0.lock().unwrap().as_deref(),
            Some("unsaved text")
        );

        let ok = flush_pending(&pending, |text| {
            assert_eq!(text, "unsaved text");
            Ok(456)
        });
        assert_eq!(ok, Ok(Some(456)));
        assert_eq!(*pending.0.lock().unwrap(), None);
    }

    #[test]
    fn write_draft_to_writes_file_without_leaving_tmp() {
        let dir = TempDir::new();
        let path = dir.0.join(DRAFT_FILE);
        let saved_at = write_draft_to(&path, "hello\nworld").unwrap();
        assert!(saved_at > 0);
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello\nworld");
        assert!(!path.with_extension("txt.tmp").exists());
    }
}
