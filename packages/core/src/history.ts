import { NestError } from "./errors.js";
import type { Command } from "./mapOps.js";
import type { Project } from "./project.js";

const DEFAULT_LIMIT = 200;

/**
 * Undo/redo stacks of commands. The history does not hold the project: each
 * call takes the current project and returns the new one. Past `limit` steps
 * the oldest one is dropped.
 */
export class History {
  private readonly limit: number;
  private done: Command[] = [];
  private undone: Command[] = [];

  constructor(limit: number = DEFAULT_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new NestError("invalid_history_limit", "history limit must be a whole number of at least 1");
    }
    this.limit = limit;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** Number of steps that can be undone. */
  get size(): number {
    return this.done.length;
  }

  /** Applies `cmd` and records it; clears redo. A command that throws is not recorded. */
  push(cmd: Command, p: Project): Project {
    const next = cmd.apply(p);
    this.done.push(cmd);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
    return next;
  }

  /** Reverts the last step; on an empty history returns `p` unchanged. */
  undo(p: Project): Project {
    const cmd = this.done.at(-1);
    if (cmd === undefined) return p;
    const next = cmd.revert(p);
    this.done.pop();
    this.undone.push(cmd);
    return next;
  }

  /** Re-applies the last undone step; with nothing to redo returns `p` unchanged. */
  redo(p: Project): Project {
    const cmd = this.undone.at(-1);
    if (cmd === undefined) return p;
    const next = cmd.apply(p);
    this.undone.pop();
    this.done.push(cmd);
    return next;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }
}
