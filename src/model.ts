import {
  type CamapDocument,
  type Feature,
  type FeatureKind,
  type Point,
  type Collection,
  type Entity,
} from "@campura/camap";
export const uid = () => crypto.randomUUID();
export const labels: Record<FeatureKind, string> = {
  area: "区域",
  building: "建筑",
  merchant: "商户",
  room: "房间",
  door: "门",
  gate: "校门",
  stairs: "楼梯",
  elevator: "电梯",
  poi: "地标",
  text: "文字",
};
export const colors: Record<FeatureKind, string> = {
  area: "#d5e5d0",
  building: "#d2ddd8",
  merchant: "#e5d0a8",
  room: "#d5d1e8",
  door: "#236a5c",
  gate: "#236a5c",
  stairs: "#b9754c",
  elevator: "#8474aa",
  poi: "#567c9a",
  text: "#253d35",
};
export function addFeature(
  doc: CamapDocument,
  kind: FeatureKind,
  p: Point,
  end?: Point,
  buildingId?: string,
  levelId?: string,
  frameId?: string,
): { doc: CamapDocument; feature: Feature } {
  const next = structuredClone(doc);
  let frame = next.frames.find((f) => f.id === frameId) || next.frames[0];
  if (!frame) {
    frame = { id: uid(), revision: 1, name: "区域 1", unit: "m", bindings: {} };
    next.frames.push(frame);
  }
  const polygon = ["area", "building", "merchant", "room"].includes(kind),
    q = end || [p[0] + 24, p[1] + 16];
  const f: Feature = {
    id: uid(),
    revision: 1,
    frameId: frame.id,
    kind,
    name: labels[kind],
    geometry: polygon
      ? { type: "polygon", coordinates: [p, [q[0], p[1]], q, [p[0], q[1]]] }
      : { type: "point", coordinates: p },
    source: { method: "manual" },
  };
  if (kind === "building")
    f.levels = [
      { id: uid(), label: "1F", ordinal: 1 },
      { id: uid(), label: "2F", ordinal: 2 },
    ];
  if (
    buildingId &&
    !["building", "area", "poi", "text", "gate"].includes(kind)
  ) {
    f.buildingId = buildingId;
    if (levelId) f.levelId = levelId;
  }
  if (kind === "door" || kind === "gate") {
    f.exterior = kind === "gate";
    f.accessible = true;
  }
  if (kind === "stairs" || kind === "elevator")
    f.servedLevelIds = levelId ? [levelId] : [];
  next.features.push(f);
  return { doc: next, feature: f };
}
export function deleteEntity(
  doc: CamapDocument,
  collection: Collection,
  id: string,
): CamapDocument {
  const next = structuredClone(doc),
    remove = new Set([id]);
  if (collection === "features") {
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of next.features)
        if (
          !remove.has(f.id) &&
          (remove.has(f.buildingId || "") || remove.has(f.parentId || ""))
        ) {
          remove.add(f.id);
          changed = true;
        }
    }
    for (const n of next.nodes)
      if (remove.has(n.entranceId || "")) remove.add(n.id);
  }
  if (collection === "features" || collection === "nodes")
    for (const e of next.edges)
      if (remove.has(e.from) || remove.has(e.to)) remove.add(e.id);
  for (const c of ["features", "nodes", "edges"] as Collection[]) {
    for (const e of next[c])
      if (
        remove.has(e.id) &&
        !next.tombstones.some((t) => t.id === e.id && t.collection === c)
      )
        next.tombstones.push({ collection: c, id: e.id });
    (next[c] as Entity[]) = next[c].filter((e) => !remove.has(e.id));
  }
  return next;
}
export function updateFeature(
  doc: CamapDocument,
  feature: Feature,
): CamapDocument {
  const next = structuredClone(doc);
  next.features = next.features.map((f) =>
    f.id === feature.id ? { ...feature, revision: f.revision + 1 } : f,
  );
  if (feature.geometry.type === "point")
    for (const n of next.nodes)
      if (n.entranceId === feature.id) {
        n.position = feature.geometry.coordinates;
        n.revision++;
      }
  return next;
}
