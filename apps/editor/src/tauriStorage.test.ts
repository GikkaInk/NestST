import { describe, expect, it } from "vitest";
import { NestError } from "@nestst/core";
import { TauriStorage, createTauriSession, pickNewProject, pickOpenProject } from "./tauriStorage.js";
import type { InvokeFn } from "./tauriStorage.js";

interface Call {
  cmd: string;
  args: Record<string, unknown> | undefined;
}

/** Fake `invoke`: records calls and answers from `reply`. */
function fakeInvoke(reply: (cmd: string, args?: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  const invoke: InvokeFn = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ cmd, args });
    return (await reply(cmd, args)) as T;
  };
  return { invoke, calls };
}

const ROOT = "/home/user/Проекты/Моя игра";

describe("TauriStorage", () => {
  it("passes root and relative paths unchanged to the commands", async () => {
    const { invoke, calls } = fakeInvoke((cmd) =>
      cmd === "project_read" ? "{}" : cmd === "project_exists" ? true : null,
    );
    const s = new TauriStorage(ROOT, invoke);
    expect(await s.read("maps/главная карта.json")).toBe("{}");
    await s.writeAtomic("maps/main.json", "data ✓");
    expect(await s.exists("nestst.project.json")).toBe(true);
    expect(calls).toEqual([
      { cmd: "project_read", args: { root: ROOT, path: "maps/главная карта.json" } },
      { cmd: "project_write_atomic", args: { root: ROOT, path: "maps/main.json", data: "data ✓" } },
      { cmd: "project_exists", args: { root: ROOT, path: "nestst.project.json" } },
    ]);
  });

  it("returns false from exists when the command says so", async () => {
    const { invoke } = fakeInvoke(() => false);
    expect(await new TauriStorage(ROOT, invoke).exists("x.json")).toBe(false);
  });

  it("maps a Rust error string to a NestError that keeps the file", async () => {
    const { invoke } = fakeInvoke(() => {
      throw "File maps/main.json was not found";
    });
    const s = new TauriStorage(ROOT, invoke);
    const err = await s.read("maps/main.json").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NestError);
    expect((err as NestError).code).toBe("read_failed");
    expect((err as NestError).message).toBe("File maps/main.json was not found");
    expect((err as NestError).file).toBe("maps/main.json");

    const w = await s.writeAtomic("maps/main.json", "x").catch((e: unknown) => e);
    expect((w as NestError).code).toBe("save_failed");
    expect((w as NestError).file).toBe("maps/main.json");

    const x = await s.exists("a.json").catch((e: unknown) => e);
    expect((x as NestError).code).toBe("read_failed");
  });

  it("maps a thrown Error or odd value to a plain English message", async () => {
    const boom = fakeInvoke(() => {
      throw new Error("IPC is broken");
    });
    const e1 = await new TauriStorage(ROOT, boom.invoke).read("a.json").catch((e: unknown) => e);
    expect((e1 as NestError).message).toBe("IPC is broken");
    const odd = fakeInvoke(() => {
      throw { weird: true };
    });
    const e2 = await new TauriStorage(ROOT, odd.invoke).read("a.json").catch((e: unknown) => e);
    expect((e2 as NestError).message).toMatch(/^Could not read file a\.json/);
  });

  it("rejects a non-string read result and a non-boolean exists result", async () => {
    const { invoke } = fakeInvoke(() => 42);
    const s = new TauriStorage(ROOT, invoke);
    await expect(s.read("a.json")).rejects.toBeInstanceOf(NestError);
    await expect(s.exists("a.json")).rejects.toBeInstanceOf(NestError);
  });
});

describe("folder pickers", () => {
  it("pickOpenProject returns a storage bound to the picked root", async () => {
    const { invoke, calls } = fakeInvoke((cmd) => (cmd === "open_project_dialog" ? ROOT : "{}"));
    const picked = await pickOpenProject(invoke);
    expect(picked?.label).toBe(ROOT);
    expect(picked?.storage).toBeInstanceOf(TauriStorage);
    expect((picked!.storage as TauriStorage).root).toBe(ROOT);
    await picked!.storage.read("nestst.project.json");
    expect(calls[1]).toEqual({ cmd: "project_read", args: { root: ROOT, path: "nestst.project.json" } });
  });

  it("pickNewProject uses the new-project dialog", async () => {
    const { invoke, calls } = fakeInvoke(() => "/tmp/new");
    expect((await pickNewProject(invoke))?.label).toBe("/tmp/new");
    expect(calls[0]?.cmd).toBe("new_project_dialog");
  });

  it("returns null when the dialog is cancelled", async () => {
    const { invoke } = fakeInvoke(() => null);
    expect(await pickOpenProject(invoke)).toBeNull();
    expect(await pickNewProject(invoke)).toBeNull();
  });

  it("turns a dialog error into a NestError", async () => {
    const { invoke } = fakeInvoke(() => {
      throw 'Project folder "/x" was not found';
    });
    const err = await pickOpenProject(invoke).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NestError);
    expect((err as NestError).code).toBe("folder_pick_failed");
    expect((err as NestError).message).toBe('Project folder "/x" was not found');
  });

  it("createTauriSession wires both pickers", async () => {
    const { invoke, calls } = fakeInvoke(() => ROOT);
    const session = createTauriSession(invoke);
    await session.pickNew();
    await session.pickOpen();
    expect(calls.map((c) => c.cmd)).toEqual(["new_project_dialog", "open_project_dialog"]);
  });
});
