pub mod files;

use files::ProjectRoot;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Shows a folder picker; the chosen folder becomes the project root.
/// Cancelling keeps the current root. Runs off the main thread (async
/// command), so the blocking picker does not freeze the window.
fn pick_root(app: &AppHandle, title: &str) -> Option<String> {
  let picked = app
    .dialog()
    .file()
    .set_title(title)
    .set_can_create_directories(true)
    .blocking_pick_folder()?;
  let path = picked.into_path().ok()?;
  let state = app.state::<ProjectRoot>();
  let mut root = state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  *root = Some(path.clone());
  Some(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn open_project_dialog(app: AppHandle) -> Option<String> {
  pick_root(&app, "Open NestST project folder")
}

#[tauri::command]
async fn new_project_dialog(app: AppHandle) -> Option<String> {
  pick_root(&app, "Choose a folder for the new NestST project")
}

/// Runs blocking file work on a worker thread.
async fn on_worker<T: Send + 'static>(
  job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
  tauri::async_runtime::spawn_blocking(job)
    .await
    .map_err(|_| "Internal error while accessing the project files".to_string())?
}

#[tauri::command]
async fn project_read(state: State<'_, ProjectRoot>, path: String) -> Result<String, String> {
  let root = files::current_root(&state)?;
  on_worker(move || files::read_text(&root, &path)).await
}

#[tauri::command]
async fn project_write_atomic(
  state: State<'_, ProjectRoot>,
  path: String,
  data: String,
) -> Result<(), String> {
  let root = files::current_root(&state)?;
  on_worker(move || files::write_atomic(&root, &path, data.as_bytes())).await
}

#[tauri::command]
async fn project_exists(state: State<'_, ProjectRoot>, path: String) -> Result<bool, String> {
  let root = files::current_root(&state)?;
  on_worker(move || files::exists(&root, &path)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(ProjectRoot::default())
    .invoke_handler(tauri::generate_handler![
      open_project_dialog,
      new_project_dialog,
      project_read,
      project_write_atomic,
      project_exists
    ])
    .run(tauri::generate_context!())
    .expect("error while running NestST");
}
