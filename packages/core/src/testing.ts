/// <reference types="node" />
/**
 * Test helpers, published as `@nestst/core/testing`. This is the only module
 * of core that may use Node APIs; the main entry point stays free of them.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { NestError } from "./errors.js";
import type { ProjectStorage } from "./storage.js";

/** In-memory storage; can be told to fail on the N-th write call. */
export class MemoryStorage implements ProjectStorage {
  readonly files = new Map<string, string>();
  /** Paths of successful writes, in order. */
  readonly writeLog: string[] = [];
  private writeCalls = 0;
  private failAt: number | undefined;

  constructor(initial?: Record<string, string>) {
    if (initial) for (const [k, v] of Object.entries(initial)) this.files.set(k, v);
  }

  /** The n-th write call from now (1-based) rejects and stores nothing. */
  failOnWrite(n: number): void {
    this.writeCalls = 0;
    this.failAt = n;
  }

  async read(path: string): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`file not found: ${path}`);
    return text;
  }

  async writeAtomic(path: string, data: string): Promise<void> {
    this.writeCalls += 1;
    if (this.writeCalls === this.failAt) throw new Error("simulated write failure");
    this.files.set(path, data);
    this.writeLog.push(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

/** Storage on the real file system under `rootDir` (tests only). */
export class NodeFsStorage implements ProjectStorage {
  constructor(readonly rootDir: string) {}

  private resolve(path: string): string {
    const parts = path.split("/");
    const unsafe =
      path === "" ||
      path.includes("\\") ||
      path.includes("\0") ||
      parts.some((p) => p === "" || p === "." || p === "..");
    if (unsafe) {
      throw new NestError("unsafe_path", `path "${path}" is not allowed inside the project folder`, path);
    }
    return join(this.rootDir, ...parts);
  }

  async read(path: string): Promise<string> {
    return readFile(this.resolve(path), "utf8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      return (await stat(this.resolve(path))).isFile();
    } catch (e) {
      if (e instanceof NestError) throw e;
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  }

  /** Temp file next to the target, fsync, then rename over the target. */
  async writeAtomic(path: string, data: string): Promise<void> {
    const target = this.resolve(path);
    const dir = dirname(target);
    await mkdir(dir, { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      const handle = await open(tmp, "wx");
      try {
        await writeFile(handle, data, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmp, target);
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      throw e;
    }
    // Best effort: make the rename itself durable.
    try {
      const d = await open(dir, "r");
      try {
        await d.sync();
      } finally {
        await d.close();
      }
    } catch {
      // Some file systems do not allow fsync on a directory.
    }
  }
}
