import { describe, expect, it } from "vitest";
import { NestError, parseManifest, parseMap } from "./index.js";

const ENGLISH = /Invalid|expected|received|Too |Required|Expected|must be|string|number|undefined/;

function validMap(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "town",
    name: "Город",
    viewMode: "topdown",
    width: 4,
    height: 3,
    tileSize: 16,
    layers: [
      { id: "ground", name: "Земля", visible: true, tiles: new Array(12).fill(1) },
      { id: "deco", name: "Декор", visible: false, tiles: new Array(12).fill(0) },
    ],
    ...over,
  };
}

function validManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "Моя игра",
    resolution: { width: 640, height: 360 },
    tileSize: 16,
    maps: [
      { id: "town", file: "maps/town.json" },
      { id: "cave", file: "maps/cave.json" },
    ],
    startMapId: "town",
    ...over,
  };
}

function mapError(raw: unknown, file?: string): NestError {
  try {
    parseMap(raw, file);
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    const err = e as NestError;
    expect(err.message).not.toMatch(ENGLISH);
    return err;
  }
  throw new Error("ожидался отказ, но карта принята");
}

function manifestError(raw: unknown, file?: string): NestError {
  try {
    parseManifest(raw, file);
  } catch (e) {
    expect(e).toBeInstanceOf(NestError);
    const err = e as NestError;
    expect(err.message).not.toMatch(ENGLISH);
    return err;
  }
  throw new Error("ожидался отказ, но манифест принят");
}

describe("parseMap", () => {
  it("принимает валидную карту 4×3 с двумя слоями", () => {
    const map = parseMap(validMap());
    expect(map.width).toBe(4);
    expect(map.layers).toHaveLength(2);
  });

  it("размер слоя не равен width*height", () => {
    const err = mapError(validMap({ layers: [{ id: "g", name: "Земля", visible: true, tiles: [1, 2] }] }));
    expect(err.message).toContain("размер слоя");
    expect(err.message).toContain("Земля");
  });

  it.each([0, 2049, 1.5, -3])("width: %s отклоняется с путём и диапазоном", (w) => {
    const err = mapError(validMap({ width: w }));
    expect(err.message).toBe("в карте «Город», поле width: должно быть целое число от 1 до 2048");
  });

  it.each([256, -1, 2.5])("id плитки %s отклоняется", (t) => {
    const layers = [{ id: "g", name: "З", visible: true, tiles: [0, 0, t, ...new Array(9).fill(0)] }];
    const err = mapError(validMap({ layers }));
    expect(err.message).toContain("layers[0].tiles[2]");
    expect(err.message).toContain("от 0 до 255");
  });

  it("viewMode sideview отклоняется", () => {
    const err = mapError(validMap({ viewMode: "sideview" }));
    expect(err.message).toContain("viewMode");
  });

  it.each(["../x", "A", "", "a/b", "x".repeat(65)])("id %j отклоняется", (id) => {
    const err = mapError(validMap({ id }));
    expect(err.message).toContain("поле id");
  });

  it("сохраняет неизвестные ключи на карте и в слое", () => {
    const raw = validMap({ extra: 1 });
    (raw.layers as Record<string, unknown>[])[0].extra2 = { a: 1 };
    const map = parseMap(raw);
    expect(map.extra).toBe(1);
    expect(map.layers[0].extra2).toEqual({ a: 1 });
  });

  it.each([null, "x", [], 5, undefined])("не-объект %j отклоняется по-русски", (raw) => {
    const err = mapError(raw);
    expect(err.message).toContain("должен быть объект");
  });

  it("пустой список слоёв и больше 16 слоёв", () => {
    expect(mapError(validMap({ layers: [] })).message).toContain("поле layers");
    const many = Array.from({ length: 17 }, (_, i) => ({
      id: `l${i}`, name: "n", visible: true, tiles: new Array(12).fill(0),
    }));
    expect(mapError(validMap({ layers: many })).message).toContain("не может быть больше 16 элементов");
  });

  it("дублирующиеся id слоёв", () => {
    const l = { id: "g", name: "З", visible: true, tiles: new Array(12).fill(0) };
    expect(mapError(validMap({ layers: [l, { ...l }] })).message).toContain("повторяется");
  });

  it("отсутствующее поле, неверный тип, пустая и слишком длинная строка", () => {
    const raw = validMap();
    delete raw.height;
    expect(mapError(raw).message).toContain("поле height: поле обязательно, но отсутствует");
    expect(mapError(validMap({ name: 5 })).message).toContain("поле name: должна быть строка");
    expect(mapError(validMap({ name: "" })).message).toContain("не должно быть пустым");
    expect(mapError(validMap({ name: "я".repeat(201) })).message).toContain("не может быть больше 200 символов");
    const badLayer = [{ id: "g", name: "З", visible: "да", tiles: new Array(12).fill(0) }];
    expect(mapError(validMap({ layers: badLayer })).message).toContain("layers[0].visible: должно быть «да» или «нет»");
    expect(mapError(validMap({ layers: "x" })).message).toContain("должен быть список");
  });

  it("schemaVersion: чужая версия и более новая", () => {
    expect(mapError(validMap({ schemaVersion: 0 })).message).toContain("версия формата должна быть 1");
    const err = mapError(validMap({ schemaVersion: 2 }), "maps/town.json");
    expect(err.code).toBe("newer-version");
    expect(err.message).toContain("Обновите NestST");
    expect(err.file).toBe("maps/town.json");
  });

  it("имя файла попадает в сообщение и в NestError.file", () => {
    const err = mapError(validMap({ width: 0 }), "maps/town.json");
    expect(err.file).toBe("maps/town.json");
    expect(err.message).toContain("maps/town.json");
  });
});

describe("parseManifest", () => {
  it("принимает валидный манифест и сохраняет неизвестные ключи", () => {
    const m = parseManifest(validManifest({ extra: true }));
    expect(m.maps).toHaveLength(2);
    expect(m.extra).toBe(true);
  });

  it("maps[].file должен быть maps/<id>.json", () => {
    const err = manifestError(validManifest({ maps: [{ id: "town", file: "../town.json" }] }));
    expect(err.message).toContain("maps[0].file");
    expect(err.message).toContain("maps/town.json");
  });

  it("startMapId обязан быть среди maps", () => {
    const err = manifestError(validManifest({ startMapId: "nowhere" }));
    expect(err.message).toContain("startMapId");
    expect(err.message).toContain("нет среди карт");
  });

  it("дублирующиеся id карт", () => {
    const maps = [{ id: "town", file: "maps/town.json" }, { id: "town", file: "maps/town.json" }];
    expect(manifestError(validManifest({ maps })).message).toContain("больше одного раза");
  });

  it("небезопасный id карты и startMapId", () => {
    expect(manifestError(validManifest({ maps: [{ id: "../x", file: "maps/../x.json" }] })).message).toContain("maps[0].id");
    expect(manifestError(validManifest({ startMapId: "A" })).message).toContain("startMapId");
  });

  it("разрешение, не-объект, отсутствующие поля, новая версия", () => {
    expect(manifestError(validManifest({ resolution: { width: 0, height: 360 } })).message).toContain(
      "resolution.width: должно быть целое число от 1 до 16384",
    );
    expect(manifestError(null).message).toContain("должен быть объект");
    const raw = validManifest();
    delete raw.maps;
    expect(manifestError(raw).message).toContain("поле maps: поле обязательно, но отсутствует");
    expect(manifestError(validManifest({ schemaVersion: 9 })).code).toBe("newer-version");
  });

  it("имя проекта с кириллицей и пробелами допустимо, пустое — нет", () => {
    expect(parseManifest(validManifest({ name: "Моя  игра №1" })).name).toBe("Моя  игра №1");
    expect(manifestError(validManifest({ name: "" })).message).toContain("поле name");
  });
});
