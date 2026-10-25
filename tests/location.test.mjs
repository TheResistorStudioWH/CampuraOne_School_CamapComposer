import { test } from "node:test";
import assert from "node:assert/strict";
import { locateCampus } from "../src/location.ts";

test("desktop location converts WGS-84 exactly once and preserves accuracy", async (t) => {
  const previous = globalThis.window;
  t.after(() => {
    globalThis.window = previous;
  });
  let conversions = 0;
  globalThis.window = {
    AMap: {
      convertFrom(point, type, callback) {
        conversions++;
        assert.deepEqual(point, [114.3, 30.5]);
        assert.equal(type, "gps");
        callback("complete", { locations: [{ lng: 114.305, lat: 30.498 }] });
      },
    },
  };
  const bridge = {
    desktop: () => true,
    locate: async () => ({ longitude: 114.3, latitude: 30.5, accuracy: 25 }),
    cancel: async () => {},
  };
  assert.deepEqual(await locateCampus(undefined, bridge), {
    position: [114.305, 30.498],
    accuracy: 25,
    approximate: false,
  });
  assert.equal(conversions, 1);
  bridge.locate = async () => ({
    longitude: 114.3,
    latitude: 30.5,
    accuracy: 1000,
  });
  assert.equal((await locateCampus(undefined, bridge)).approximate, true);
});

test("native denial and conversion failures never masquerade as a successful fix", async (t) => {
  const previous = globalThis.window;
  t.after(() => {
    globalThis.window = previous;
  });
  globalThis.window = {
    AMap: {
      convertFrom(_, __, callback) {
        callback("error", { info: "provider details should not leak" });
      },
    },
  };
  const bridge = {
    desktop: () => true,
    locate: async () => {
      throw "macOS 未允许定位。";
    },
    cancel: async () => {},
  };
  await assert.rejects(locateCampus(undefined, bridge), /macOS 未允许定位/);
  bridge.locate = async () => ({
    longitude: 114.3,
    latitude: 30.5,
    accuracy: 25,
  });
  await assert.rejects(locateCampus(undefined, bridge), /高德坐标转换失败/);
  bridge.locate = async () => ({
    longitude: null,
    latitude: 30.5,
    accuracy: 25,
  });
  await assert.rejects(locateCampus(undefined, bridge), /未提供有效位置/);
});

test("cancelling stops the native request and ignores late fixes and conversion callbacks", async (t) => {
  const previous = globalThis.window;
  t.after(() => {
    globalThis.window = previous;
  });
  let resolveFix,
    callback,
    conversions = 0,
    startedId,
    cancelledId;
  globalThis.window = {
    AMap: {
      convertFrom(_, __, cb) {
        conversions++;
        callback = cb;
      },
    },
  };
  const bridge = {
    desktop: () => true,
    locate: (id) => {
      startedId = id;
      return new Promise((r) => {
        resolveFix = r;
      });
    },
    cancel: async (id) => {
      cancelledId = id;
    },
  };
  const controller = new AbortController();
  const pending = locateCampus(controller.signal, bridge);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelledId, startedId);
  resolveFix({ longitude: 114.3, latitude: 30.5, accuracy: 25 });
  await Promise.resolve();
  assert.equal(conversions, 0);
  const second = new AbortController();
  bridge.locate = async () => ({
    longitude: 114.3,
    latitude: 30.5,
    accuracy: 25,
  });
  const converting = locateCampus(second.signal, bridge);
  await Promise.resolve();
  second.abort();
  callback("complete", { locations: [{ lng: 114.3, lat: 30.5 }] });
  await assert.rejects(converting, { name: "AbortError" });
});
