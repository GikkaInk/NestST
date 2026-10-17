import { invoke, isTauri } from "@tauri-apps/api/core";

export function markReady(): void {
  if (!isTauri()) return;
  invoke("report_ready").catch(() => {});
}

export interface Flags {
  bench: boolean;
  gpufail: boolean;
}

/** Flags come from the URL query (browser/dev) or from NESTST_BENCH / NESTST_GPUFAIL env vars (Tauri). */
export async function readFlags(): Promise<Flags> {
  const params = new URLSearchParams(window.location.search);
  const flags: Flags = { bench: params.has("bench"), gpufail: params.has("gpufail") };
  if (isTauri()) {
    try {
      flags.bench ||= await invoke<boolean>("is_bench");
      flags.gpufail ||= await invoke<boolean>("is_gpufail");
    } catch {
      // keep URL-derived flags
    }
  }
  return flags;
}

export function reportMetric(line: string): void {
  if (!isTauri()) {
    console.log(`BENCH ${line}`);
    return;
  }
  invoke("report_metric", { line }).catch(() => {});
}

/** Prints final RSS (process tree, from Rust) and exits the app. */
export function exitApp(): void {
  if (isTauri()) invoke("exit_app").catch(() => {});
}
