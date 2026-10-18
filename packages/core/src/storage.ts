/**
 * Access to the files of one project folder. Paths are relative to the
 * project root and always use "/" (for example `maps/main.json`).
 * Core never touches the file system directly: the editor (Tauri) and tests
 * provide their own implementation.
 */
export interface ProjectStorage {
  /** Whole file as UTF-8 text; rejects if the file cannot be read. */
  read(path: string): Promise<string>;
  /**
   * Replaces the file as a whole: after the promise settles the file is either
   * entirely old or entirely new, never half-written (temp file + rename).
   * Creates missing parent folders.
   */
  writeAtomic(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}
