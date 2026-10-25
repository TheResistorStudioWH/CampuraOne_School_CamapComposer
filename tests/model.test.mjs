import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addFeature, updateFeature, deleteEntity } from "../src/model.ts";
import { assertDocument } from "@campura/camap";
const sample = () =>
  JSON.parse(readFileSync(new URL("../src/demo.json", import.meta.url)));
test("building creation provides stable floors and supports stairs serving both", () => {
  let doc = sample();
  const added = addFeature(doc, "building", [100, 100], [120, 130]);
  doc = added.doc;
  const stair = addFeature(
    doc,
    "stairs",
    [102, 105],
    undefined,
    added.feature.id,
    added.feature.levels[0].id,
  );
  stair.feature.servedLevelIds = added.feature.levels.map((l) => l.id);
  assertDocument(stair.doc);
  assert.equal(stair.feature.servedLevelIds.length, 2);
  assert.equal(doc.features.length, 6);
  assert.equal(sample().features.length, 5);
});
test("moving an exterior door moves its attached outdoor route node", () => {
  const doc = sample(),
    door = doc.features.find((f) => f.kind === "door");
  const next = updateFeature(doc, {
    ...door,
    geometry: { type: "point", coordinates: [10, 20] },
  });
  const node = next.nodes.find((n) => n.entranceId === door.id);
  assert.deepEqual(node.position, [10, 20]);
  assertDocument(next);
  assert.notDeepEqual(
    doc.nodes.find((n) => n.id === node.id).position,
    node.position,
  );
});
test("deleting a building removes dependent objects and edges with explicit tombstones", () => {
  const doc = sample(),
    building = doc.features.find((f) => f.kind === "building"),
    next = deleteEntity(doc, "features", building.id);
  assert.equal(next.features.length, 1);
  assert.equal(next.nodes.length, 1);
  assert.equal(next.edges.length, 0);
  assert(next.tombstones.some((t) => t.collection === "edges"));
  assertDocument(next);
});
test("deleting a road does not delete its endpoints", () => {
  const doc = sample(),
    next = deleteEntity(doc, "edges", doc.edges[0].id);
  assert.equal(next.nodes.length, doc.nodes.length);
  assert.equal(next.features.length, doc.features.length);
  assertDocument(next);
});
