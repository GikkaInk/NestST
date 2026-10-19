import { describe, expect, it, vi } from "vitest";
import { watchResize } from "./resizeWatch.js";

class FakeObserver {
  static last: FakeObserver;
  observed: Element[] = [];
  disconnected = false;
  constructor(public cb: () => void) {
    FakeObserver.last = this;
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
}

describe("watchResize", () => {
  it("observes the host, calls back on resize and disconnects on stop", () => {
    const host = {} as Element;
    const onResize = vi.fn();
    const stop = watchResize(host, onResize, FakeObserver as unknown as typeof ResizeObserver);
    expect(FakeObserver.last.observed).toEqual([host]);
    FakeObserver.last.cb();
    expect(onResize).toHaveBeenCalledTimes(1);
    stop();
    expect(FakeObserver.last.disconnected).toBe(true);
  });
});
