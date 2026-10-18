//! Sandboxed access to the files of one project folder.
//!
//! Every path coming from the web side is relative to the project root and
//! uses `/` separators. Nothing outside the root can be read or written.

use std::fs::{self, File, OpenOptions};
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Largest file the editor reads or writes (256 MB).
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;

/// Longest allowed name of one path segment, in bytes (Linux NAME_MAX).
const MAX_SEGMENT_BYTES: usize = 255;

/// How many unique temp names to try before giving up.
const TEMP_ATTEMPTS: u32 = 16;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// The project folder chosen by the user; `None` until a folder is picked.
#[derive(Default)]
pub struct ProjectRoot(pub Mutex<Option<PathBuf>>);

/// The chosen project folder, or an error if none has been picked yet.
pub fn current_root(state: &ProjectRoot) -> Result<PathBuf, String> {
  let guard = state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  guard
    .clone()
    .ok_or_else(|| "No project folder is open. Open or create a project first.".to_string())
}

/// Plain English description of an I/O error. The OS text is not used: once
/// GTK sets the locale it may come back translated.
fn describe(e: &io::Error) -> String {
  let text = match e.kind() {
    ErrorKind::NotFound => "not found",
    ErrorKind::PermissionDenied => "permission denied",
    ErrorKind::AlreadyExists => "already exists",
    ErrorKind::IsADirectory => "it is a folder, not a file",
    ErrorKind::NotADirectory => "a part of the path is a file, not a folder",
    ErrorKind::DirectoryNotEmpty => "the folder is not empty",
    ErrorKind::StorageFull => "the disk is full",
    ErrorKind::QuotaExceeded => "the disk quota is exceeded",
    ErrorKind::ReadOnlyFilesystem => "the disk is read-only",
    ErrorKind::FileTooLarge => "the file is too large for this disk",
    ErrorKind::InvalidFilename => "the name is not valid on this disk",
    ErrorKind::Interrupted => "the operation was interrupted",
    _ => {
      return match e.raw_os_error() {
        Some(code) => format!("input/output error (code {code})"),
        None => "input/output error".to_string(),
      };
    }
  };
  text.to_string()
}

fn too_large(rel: &str, limit: u64) -> String {
  const MB: u64 = 1024 * 1024;
  if limit >= MB {
    format!("File \"{rel}\" is too large (the limit is {} MB)", limit / MB)
  } else {
    format!("File \"{rel}\" is too large (the limit is {limit} bytes)")
  }
}

/// Checks the shape of a relative project path without touching the disk.
fn validate_rel(rel: &str) -> Result<(), String> {
  if rel.is_empty() {
    return Err("File path is empty".to_string());
  }
  if rel.contains('\0') {
    return Err("File path contains a NUL character".to_string());
  }
  if rel.starts_with('/') {
    return Err(format!("File path \"{rel}\" must be relative to the project folder"));
  }
  if rel.contains('\\') {
    return Err(format!("File path \"{rel}\" must use \"/\" as the separator, not \"\\\""));
  }
  for seg in rel.split('/') {
    if seg.is_empty() {
      return Err(format!("File path \"{rel}\" has an empty part"));
    }
    if seg == "." || seg == ".." {
      return Err(format!("File path \"{rel}\" must not contain \".\" or \"..\""));
    }
    if seg.len() > MAX_SEGMENT_BYTES {
      return Err(format!(
        "File path \"{rel}\" has a name longer than {MAX_SEGMENT_BYTES} bytes"
      ));
    }
  }
  Ok(())
}

/// Returns the canonical root and the target path inside it.
fn resolve_parts(root: &Path, rel: &str) -> Result<(PathBuf, PathBuf), String> {
  validate_rel(rel)?;
  let not_found = || {
    format!(
      "Project folder \"{}\" was not found (needed for \"{rel}\")",
      root.display()
    )
  };
  let canon_root = fs::canonicalize(root).map_err(|_| not_found())?;
  if !canon_root.is_dir() {
    return Err(not_found());
  }
  // Defence in depth: walk the part of the path that already exists and make
  // sure no symlink in it leads outside the project folder.
  let mut current = canon_root.clone();
  for seg in rel.split('/') {
    current.push(seg);
    match fs::symlink_metadata(&current) {
      Ok(meta) => {
        if meta.file_type().is_symlink() {
          match fs::canonicalize(&current) {
            Ok(real) if real.starts_with(&canon_root) => {}
            Ok(_) => {
              return Err(format!("File path \"{rel}\" leads outside the project folder"));
            }
            Err(_) => {
              return Err(format!("File path \"{rel}\" goes through a broken link"));
            }
          }
        }
      }
      Err(e) if e.kind() == ErrorKind::NotFound => break,
      Err(e) => return Err(format!("Cannot open \"{rel}\": {}", describe(&e))),
    }
  }
  let target = canon_root.join(rel);
  Ok((canon_root, target))
}

/// Turns a project-relative path (`maps/main.json`) into an absolute path
/// inside `root`, refusing anything that could leave the project folder.
pub fn resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
  resolve_parts(root, rel).map(|(_, target)| target)
}

/// Reads a whole project file as UTF-8 text.
pub fn read_text(root: &Path, rel: &str) -> Result<String, String> {
  read_text_limited(root, rel, MAX_FILE_BYTES)
}

fn read_text_limited(root: &Path, rel: &str, limit: u64) -> Result<String, String> {
  let path = resolve_in_root(root, rel)?;
  let meta = fs::metadata(&path).map_err(|e| match e.kind() {
    ErrorKind::NotFound => format!("File \"{rel}\" was not found"),
    _ => format!("Cannot read \"{rel}\": {}", describe(&e)),
  })?;
  if !meta.is_file() {
    return Err(format!("Cannot read \"{rel}\": it is not a file"));
  }
  if meta.len() > limit {
    return Err(too_large(rel, limit));
  }
  let file = File::open(&path).map_err(|e| format!("Cannot read \"{rel}\": {}", describe(&e)))?;
  let mut buf = Vec::with_capacity(meta.len() as usize);
  // `take` guards against the file growing between the size check and the read.
  file
    .take(limit + 1)
    .read_to_end(&mut buf)
    .map_err(|e| format!("Cannot read \"{rel}\": {}", describe(&e)))?;
  if buf.len() as u64 > limit {
    return Err(too_large(rel, limit));
  }
  String::from_utf8(buf).map_err(|_| format!("File \"{rel}\" is not valid UTF-8 text"))
}

/// Best-effort fsync of a folder so new entries and renames survive a crash.
fn sync_dir(dir: &Path) {
  if let Ok(handle) = File::open(dir) {
    let _ = handle.sync_all();
  }
}

/// Creates the folders of `rel` (all but the last segment) under `canon_root`.
fn create_parents(canon_root: &Path, rel: &str) -> Result<PathBuf, String> {
  let segments: Vec<&str> = rel.split('/').collect();
  let mut dir = canon_root.to_path_buf();
  for seg in &segments[..segments.len() - 1] {
    let next = dir.join(seg);
    match fs::create_dir(&next) {
      Ok(()) => sync_dir(&dir),
      Err(e) if e.kind() == ErrorKind::AlreadyExists => {
        if !next.is_dir() {
          return Err(format!(
            "Could not save \"{rel}\": a part of the path is a file, not a folder"
          ));
        }
      }
      Err(e) => return Err(format!("Could not save \"{rel}\": {}", describe(&e))),
    }
    dir = next;
  }
  Ok(dir)
}

fn create_temp(dir: &Path) -> io::Result<(PathBuf, File)> {
  let pid = std::process::id();
  let mut last_err = io::Error::from(ErrorKind::AlreadyExists);
  for _ in 0..TEMP_ATTEMPTS {
    let nanos = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|d| d.as_nanos())
      .unwrap_or(0);
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = dir.join(format!(".nestst.tmp-{pid}-{nanos}-{n}"));
    match OpenOptions::new().write(true).create_new(true).open(&path) {
      Ok(file) => return Ok((path, file)),
      Err(e) if e.kind() == ErrorKind::AlreadyExists => last_err = e,
      Err(e) => return Err(e),
    }
  }
  Err(last_err)
}

/// Replaces a project file as a whole: after this returns the file is either
/// entirely old (on error) or entirely new. Creates missing parent folders.
pub fn write_atomic(root: &Path, rel: &str, data: &[u8]) -> Result<(), String> {
  write_atomic_limited(root, rel, data, MAX_FILE_BYTES)
}

fn write_atomic_limited(root: &Path, rel: &str, data: &[u8], limit: u64) -> Result<(), String> {
  let (canon_root, target) = resolve_parts(root, rel)?;
  if data.len() as u64 > limit {
    return Err(too_large(rel, limit));
  }
  let dir = create_parents(&canon_root, rel)?;
  let fail = |e: &io::Error| format!("Could not save \"{rel}\": {}", describe(e));

  let (temp, mut file) = create_temp(&dir).map_err(|e| fail(&e))?;
  let written = (|| -> io::Result<()> {
    // Keep the permissions of the file being replaced.
    if let Ok(meta) = fs::metadata(&target)
      && meta.is_file()
    {
      let _ = file.set_permissions(meta.permissions());
    }
    file.write_all(data)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temp, &target)
  })();
  if let Err(e) = written {
    let _ = fs::remove_file(&temp);
    return Err(fail(&e));
  }
  sync_dir(&dir);
  Ok(())
}

/// Whether a file or folder exists at the project-relative path.
pub fn exists(root: &Path, rel: &str) -> Result<bool, String> {
  let path = resolve_in_root(root, rel)?;
  path
    .try_exists()
    .map_err(|e| format!("Cannot check \"{rel}\": {}", describe(&e)))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::os::unix::fs::{symlink, PermissionsExt};

  fn project() -> tempfile::TempDir {
    tempfile::Builder::new().prefix("nestst проект ").tempdir().unwrap()
  }

  fn names_in(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
      .unwrap()
      .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
      .collect();
    v.sort();
    v
  }

  fn assert_no_temp_files(dir: &Path) {
    for name in names_in(dir) {
      assert!(!name.contains(".tmp"), "temp file left behind: {name}");
    }
  }

  // ---- resolve_in_root ----

  #[test]
  fn resolve_rejects_unsafe_paths() {
    let dir = project();
    let long = "a".repeat(256);
    let long_seg = format!("maps/{long}");
    let cases = [
      "",
      "/etc/passwd",
      "../x",
      "a/../../b",
      "maps/..",
      "a\\b",
      "maps\\main.json",
      "a//b",
      "maps/",
      "./a",
      "a/./b",
      "a\0b",
      long_seg.as_str(),
    ];
    for rel in cases {
      let err = resolve_in_root(dir.path(), rel).expect_err(&format!("should reject {rel:?}"));
      assert!(!err.is_empty());
      assert!(err.is_ascii() || err.contains(rel), "message should be English: {err}");
    }
  }

  #[test]
  fn resolve_accepts_normal_paths() {
    let dir = project();
    let canon = fs::canonicalize(dir.path()).unwrap();
    for rel in ["maps/main.json", "nestst.project.json", "maps/кириллица.json", "maps/with space.json"] {
      let p = resolve_in_root(dir.path(), rel).unwrap_or_else(|e| panic!("{rel}: {e}"));
      assert_eq!(p, canon.join(rel));
    }
    let seg255 = "b".repeat(255);
    assert!(resolve_in_root(dir.path(), &seg255).is_ok());
  }

  #[test]
  fn resolve_fails_when_root_missing() {
    let dir = project();
    let gone = dir.path().join("missing-root");
    let err = resolve_in_root(&gone, "maps/main.json").unwrap_err();
    assert!(err.contains("Project folder"), "{err}");
  }

  #[test]
  fn resolve_refuses_symlinked_dir_escaping_root() {
    let dir = project();
    let outside = project();
    fs::write(outside.path().join("secret.txt"), "secret").unwrap();
    symlink(outside.path(), dir.path().join("inside")).unwrap();
    let err = resolve_in_root(dir.path(), "inside/secret.txt").unwrap_err();
    assert!(err.contains("outside the project folder"), "{err}");
    let err = read_text(dir.path(), "inside/secret.txt").unwrap_err();
    assert!(err.contains("outside the project folder"), "{err}");
    // Writing through the link is refused too, and nothing appears outside.
    assert!(write_atomic(dir.path(), "inside/new.json", b"x").is_err());
    assert!(!outside.path().join("new.json").exists());
  }

  #[test]
  fn resolve_refuses_symlinked_file_escaping_root() {
    let dir = project();
    let outside = project();
    fs::write(outside.path().join("secret.txt"), "secret").unwrap();
    symlink(outside.path().join("secret.txt"), dir.path().join("link.json")).unwrap();
    assert!(resolve_in_root(dir.path(), "link.json").is_err());
    assert!(read_text(dir.path(), "link.json").is_err());
    assert!(exists(dir.path(), "link.json").is_err());
  }

  #[test]
  fn resolve_allows_symlink_staying_inside_root() {
    let dir = project();
    fs::create_dir(dir.path().join("real")).unwrap();
    fs::write(dir.path().join("real/a.json"), "{}").unwrap();
    symlink(dir.path().join("real"), dir.path().join("alias")).unwrap();
    assert_eq!(read_text(dir.path(), "alias/a.json").unwrap(), "{}");
  }

  #[test]
  fn resolve_refuses_dangling_symlink() {
    let dir = project();
    symlink("/nonexistent/nestst-target", dir.path().join("dangling.json")).unwrap();
    assert!(resolve_in_root(dir.path(), "dangling.json").is_err());
  }

  // ---- current_root ----

  #[test]
  fn current_root_requires_a_chosen_folder() {
    let state = ProjectRoot::default();
    let err = current_root(&state).unwrap_err();
    assert!(err.contains("No project folder"), "{err}");
    *state.0.lock().unwrap() = Some(PathBuf::from("/tmp/x"));
    assert_eq!(current_root(&state).unwrap(), PathBuf::from("/tmp/x"));
  }

  // ---- write_atomic ----

  #[test]
  fn write_creates_parents_and_replaces_whole_content() {
    let dir = project();
    write_atomic(dir.path(), "maps/deep/main.json", b"a long first version").unwrap();
    let file = dir.path().join("maps/deep/main.json");
    assert_eq!(fs::read_to_string(&file).unwrap(), "a long first version");
    write_atomic(dir.path(), "maps/deep/main.json", b"v2").unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "v2");
    assert_no_temp_files(&dir.path().join("maps/deep"));
    assert_eq!(names_in(&dir.path().join("maps/deep")), vec!["main.json"]);
  }

  #[test]
  fn write_over_directory_fails_cleanly() {
    let dir = project();
    fs::create_dir_all(dir.path().join("maps/main.json")).unwrap();
    fs::write(dir.path().join("maps/other.json"), "old").unwrap();
    let err = write_atomic(dir.path(), "maps/main.json", b"new").unwrap_err();
    assert!(err.contains("maps/main.json"), "{err}");
    assert!(dir.path().join("maps/main.json").is_dir());
    assert_eq!(fs::read_to_string(dir.path().join("maps/other.json")).unwrap(), "old");
    assert_no_temp_files(&dir.path().join("maps"));
  }

  #[test]
  fn write_into_read_only_folder_keeps_old_file() {
    let dir = project();
    let maps = dir.path().join("maps");
    fs::create_dir(&maps).unwrap();
    fs::write(maps.join("main.json"), "old").unwrap();
    fs::set_permissions(&maps, fs::Permissions::from_mode(0o555)).unwrap();
    // Running as root ignores permissions: nothing to test then.
    let probe = maps.join("probe");
    if fs::write(&probe, "").is_ok() {
      let _ = fs::remove_file(&probe);
      fs::set_permissions(&maps, fs::Permissions::from_mode(0o755)).unwrap();
      return;
    }
    let result = write_atomic(dir.path(), "maps/main.json", b"new");
    fs::set_permissions(&maps, fs::Permissions::from_mode(0o755)).unwrap();
    let err = result.unwrap_err();
    assert!(err.contains("maps/main.json"), "{err}");
    assert_eq!(fs::read_to_string(maps.join("main.json")).unwrap(), "old");
    assert_no_temp_files(&maps);
  }

  #[test]
  fn write_into_missing_root_fails_and_keeps_other_files() {
    let dir = project();
    fs::write(dir.path().join("keep.json"), "old").unwrap();
    let gone = dir.path().join("no-such-root");
    assert!(write_atomic(&gone, "keep.json", b"new").is_err());
    assert!(!gone.exists());
    assert_eq!(fs::read_to_string(dir.path().join("keep.json")).unwrap(), "old");
    assert_eq!(names_in(dir.path()), vec!["keep.json"]);
  }

  #[test]
  fn write_handles_cyrillic_paths() {
    let dir = project();
    write_atomic(dir.path(), "карты/кириллица и пробел.json", "{\"name\":\"Привет\"}".as_bytes()).unwrap();
    assert_eq!(read_text(dir.path(), "карты/кириллица и пробел.json").unwrap(), "{\"name\":\"Привет\"}");
  }

  #[test]
  fn write_and_read_large_payload() {
    let dir = project();
    let data = "x".repeat(20 * 1024 * 1024);
    write_atomic(dir.path(), "maps/big.json", data.as_bytes()).unwrap();
    assert_eq!(read_text(dir.path(), "maps/big.json").unwrap().len(), data.len());
  }

  #[test]
  fn write_refuses_payload_over_limit() {
    let dir = project();
    let err = write_atomic_limited(dir.path(), "a.json", b"0123456789A", 10).unwrap_err();
    assert!(err.contains("too large"), "{err}");
    assert!(!dir.path().join("a.json").exists());
    assert_eq!(names_in(dir.path()).len(), 0);
  }

  #[test]
  fn write_rejects_unsafe_path() {
    let dir = project();
    assert!(write_atomic(dir.path(), "../escape.json", b"x").is_err());
    assert!(!dir.path().parent().unwrap().join("escape.json").exists());
  }

  // ---- read_text ----

  #[test]
  fn read_missing_file_fails_with_path() {
    let dir = project();
    let err = read_text(dir.path(), "maps/none.json").unwrap_err();
    assert!(err.contains("maps/none.json") && err.contains("not found"), "{err}");
  }

  #[test]
  fn read_non_utf8_fails() {
    let dir = project();
    fs::write(dir.path().join("bad.json"), [0xff, 0xfe, 0x00]).unwrap();
    let err = read_text(dir.path(), "bad.json").unwrap_err();
    assert!(err.contains("UTF-8"), "{err}");
  }

  #[test]
  fn read_directory_fails() {
    let dir = project();
    fs::create_dir(dir.path().join("maps")).unwrap();
    assert!(read_text(dir.path(), "maps").is_err());
  }

  #[test]
  fn read_refuses_file_over_limit() {
    let dir = project();
    fs::write(dir.path().join("a.json"), "0123456789A").unwrap();
    let err = read_text_limited(dir.path(), "a.json", 10).unwrap_err();
    assert!(err.contains("too large"), "{err}");
    assert_eq!(read_text_limited(dir.path(), "a.json", 11).unwrap(), "0123456789A");
  }

  // ---- exists ----

  #[test]
  fn exists_reports_files() {
    let dir = project();
    assert!(!exists(dir.path(), "nestst.project.json").unwrap());
    write_atomic(dir.path(), "nestst.project.json", b"{}").unwrap();
    assert!(exists(dir.path(), "nestst.project.json").unwrap());
    assert!(exists(dir.path(), "../x").is_err());
  }
}
