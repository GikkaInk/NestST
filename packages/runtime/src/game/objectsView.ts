import type { MapObject } from "@nestst/core";
import { Container, Graphics, Text } from "pixi.js";

export interface ObjectsView {
  container: Container;
  setObjects(objects: readonly MapObject[]): void;
  destroy(): void;
}

const SPAWN_COLOR = 0x4fc3a1;
const NPC_COLOR = 0xf2a93b;
const EVENT_COLOR = 0x8f7ae0;
const OUTLINE = 0x3a2e4f;

function sameObjects(a: readonly MapObject[], b: readonly MapObject[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((o, i) => {
    const p = b[i]!;
    return (
      o.id === p.id &&
      o.kind === p.kind &&
      o.x === p.x &&
      o.y === p.y &&
      o.props["name"] === p.props["name"]
    );
  });
}

/** Draws spawn points (a diamond), NPCs (a circle with its name) and events (a rounded square with its name). */
export function createObjectsView(tileSize: number): ObjectsView {
  const container = new Container({ label: "objects" });
  let shown: readonly MapObject[] | null = null;
  let destroyed = false;

  const clear = (): void => {
    for (const child of container.removeChildren()) child.destroy({ children: true });
  };

  const draw = (o: MapObject): Container => {
    const node = new Container({ label: `${o.kind}:${o.id}` });
    node.position.set(o.x * tileSize, o.y * tileSize);
    const c = tileSize / 2;
    const g = new Graphics();
    if (o.kind === "spawn") {
      g.poly([c, 1, tileSize - 1, c, c, tileSize - 1, 1, c]).fill(SPAWN_COLOR).stroke({ width: 1, color: OUTLINE });
    } else {
      if (o.kind === "event") g.roundRect(2, 2, tileSize - 4, tileSize - 4, tileSize / 5).fill(EVENT_COLOR).stroke({ width: 1, color: OUTLINE });
      else g.circle(c, c, c - 1).fill(NPC_COLOR).stroke({ width: 1, color: OUTLINE });
      const name = o.props["name"];
      const label = new Text({
        text: typeof name === "string" && name !== "" ? name : o.id,
        style: { fontSize: 8, fill: OUTLINE },
      });
      label.anchor.set(0.5, 1);
      label.position.set(c, 0);
      node.addChild(label);
    }
    node.addChildAt(g, 0);
    return node;
  };

  return {
    container,
    setObjects(objects) {
      if (destroyed) return;
      if (shown !== null && sameObjects(shown, objects)) return;
      shown = objects.map((o) => ({ ...o, props: { ...o.props } }));
      clear();
      for (const o of objects) container.addChild(draw(o));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      container.destroy({ children: true });
    },
  };
}
