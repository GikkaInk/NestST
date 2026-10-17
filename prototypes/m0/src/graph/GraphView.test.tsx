// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { demoGraph } from "./graph";
import { connectNodes, GraphView } from "./GraphView";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("GraphView", () => {
  it("renders the three demo nodes", () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <GraphView graph={demoGraph()} onChange={() => {}} />
      </div>,
    );
    expect(screen.getByText(/Здравствуй, путник!/)).toBeTruthy();
    expect(screen.getByText(/Куда пойдёшь\?/)).toBeTruthy();
    expect(screen.getByText(/Конец/)).toBeTruthy();
  });

  // @xyflow connection needs pointer geometry that happy-dom lacks, so the
  // connection logic is tested as a pure function instead.
  it("connectNodes adds an edge once", () => {
    const g = connectNodes(demoGraph(), "n1", "n3");
    expect(g.nodes[0].next).toEqual(["n2", "n3"]);
    expect(connectNodes(g, "n1", "n3").nodes[0].next).toEqual(["n2", "n3"]);
  });
});
