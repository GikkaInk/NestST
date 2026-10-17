use std::fs;
use std::sync::OnceLock;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();

fn env_flag(name: &str) -> bool {
  std::env::var(name).map(|v| v == "1").unwrap_or(false)
}

#[tauri::command]
fn report_ready() {
  if let Some(start) = START.get() {
    println!("READY {}", start.elapsed().as_millis());
  }
}

#[tauri::command]
fn is_bench() -> bool {
  env_flag("NESTST_BENCH")
}

#[tauri::command]
fn is_gpufail() -> bool {
  env_flag("NESTST_GPUFAIL")
}

#[tauri::command]
fn report_metric(line: String) {
  println!("BENCH {line}");
}

/// Sum of RSS (MB) over this process and all its descendants (WebKit helper processes).
fn rss_tree_mb() -> u64 {
  let mut procs: Vec<(u32, u32, u64)> = Vec::new(); // pid, ppid, rss pages
  if let Ok(dir) = fs::read_dir("/proc") {
    for entry in dir.flatten() {
      let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else { continue };
      let Ok(stat) = fs::read_to_string(format!("/proc/{pid}/stat")) else { continue };
      let Some(rest) = stat.rsplit_once(')').map(|(_, r)| r.to_string()) else { continue };
      let f: Vec<&str> = rest.split_whitespace().collect();
      let ppid = f.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
      let rss = f.get(21).and_then(|s| s.parse().ok()).unwrap_or(0);
      procs.push((pid, ppid, rss));
    }
  }
  let mut tree = vec![std::process::id()];
  let mut total = 0u64;
  let mut i = 0;
  while i < tree.len() {
    let cur = tree[i];
    for &(pid, ppid, rss) in &procs {
      if pid == cur {
        total += rss;
      }
      if ppid == cur {
        tree.push(pid);
      }
    }
    i += 1;
  }
  total * 4096 / 1_048_576
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
  println!("BENCH rss_mb={}", rss_tree_mb());
  app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  START.get_or_init(Instant::now);
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      report_ready,
      is_bench,
      is_gpufail,
      report_metric,
      exit_app
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
