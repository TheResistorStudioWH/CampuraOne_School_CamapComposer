import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBasemap,
  locateCampus,
  validateMapSettings,
  mapCredentialsNeedReload,
} from "../src/amap.ts";

const settings = {
  key: "test-only-key",
  securityCode: "test-only-code",
  proxy: "",
};
const binding = { longitude: 114.3, latitude: 30.5, rotation: 21 };
test("connecting credentials no longer requires a manual origin", () => {
  assert.doesNotThrow(() => validateMapSettings(settings));
  assert.throws(() => validateMapSettings({ ...settings, key: " " }), /Key/);
  assert.throws(
    () => validateMapSettings({ ...settings, securityCode: "" }),
    /安全密钥/,
  );
});

test("basemap retries failed loading, preserves its view on theme changes and cleans cancelled connections", async (t) => {
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document;
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const elements = () => ({
    style: {},
    children: [],
    removed: false,
    append(child) {
      this.children.push(child);
    },
    remove() {
      this.removed = true;
    },
  });
  const instances = [];
  class FakeMap {
    constructor(container, options) {
      this.container = container;
      this.options = options;
      this.zoom = options.zoom;
      this.center = options.center;
      this.style = options.mapStyle;
      this.events = new Map();
      this.destroyed = false;
      instances.push(this);
    }
    on(name, fn) {
      if (!this.events.has(name)) this.events.set(name, new Set());
      this.events.get(name).add(fn);
    }
    off(name, fn) {
      this.events.get(name)?.delete(fn);
    }
    emit(name, event) {
      for (const fn of [...(this.events.get(name) || [])]) fn(event);
    }
    setMapStyle(style) {
      this.style = style;
    }
    getZoom() {
      return this.zoom;
    }
    getCenter() {
      return { lng: this.center[0], lat: this.center[1] };
    }
    setZoomAndCenter(zoom, center) {
      this.zoom = zoom;
      this.center = center;
    }
    setZoom(zoom) {
      this.zoom = zoom;
      this.emit("zoomchange");
    }
    lngLatToContainer([lng, lat]) {
      return { x: lng * 1000, y: lat * 1000 };
    }
    containerToLngLat({ x, y }) {
      return { lng: x / 1000, lat: y / 1000 };
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const api = {
    Map: FakeMap,
    Pixel: class {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
    },
  };
  let failScript = true,
    scripts = 0;
  globalThis.window = {};
  globalThis.document = {
    createElement: elements,
    head: {
      append(script) {
        scripts++;
        queueMicrotask(() => {
          if (failScript) script.onerror?.();
          else {
            window.AMap = api;
            script.onload?.();
          }
        });
      },
    },
  };
  const host = elements();
  await assert.rejects(
    createBasemap(host, settings, binding, () => {}),
    /脚本加载失败/,
  );
  assert.equal(host.children.length, 0);
  failScript = false;
  let moves = 0;
  const pending = createBasemap(host, settings, binding, () => moves++, "dark");
  await new Promise(setImmediate);
  const native = instances[0];
  native.emit("complete");
  const map = await pending;
  assert.equal(scripts, 2);
  assert.equal(native.options.viewMode, "2D");
  assert.equal(native.style, "amap://styles/dark");
  map.zoom(1);
  const point = [37.25, -21.5],
    projected = map.project(point);
  const roundtrip = map.unproject(projected);
  assert.ok(
    Math.hypot(roundtrip[0] - point[0], roundtrip[1] - point[1]) < 0.00001,
  );
  map.setTheme("light");
  map.setTheme("dark");
  assert.equal(instances.length, 1);
  assert.equal(native.zoom, 19);
  assert.deepEqual(native.center, [114.3, 30.5]);
  assert.deepEqual(map.project(point), projected);
  assert.equal(moves, 1);
  assert.equal(
    mapCredentialsNeedReload({ ...settings, key: "different-key" }),
    true,
  );
  assert.equal(mapCredentialsNeedReload(settings), false);
  assert.doesNotThrow(() =>
    validateMapSettings({ ...settings, key: "different-key" }),
  );
  map.destroy();
  assert.equal(native.destroyed, true);
  assert.equal(native.container.removed, true);

  const controller = new AbortController();
  const cancelled = createBasemap(
    host,
    settings,
    binding,
    () => {},
    "light",
    controller.signal,
  );
  await new Promise(setImmediate);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(instances[1].destroyed, true);
  assert.equal(instances[1].container.removed, true);

  const failed = createBasemap(host, settings, binding, () => {});
  await new Promise(setImmediate);
  instances[2].emit("error", {
    info: "INVALID_USER_DOMAIN https://example.invalid?key=test-only-key",
  });
  await assert.rejects(
    failed,
    (error) =>
      error.message.includes("INVALID_USER_DOMAIN") &&
      !error.message.includes(settings.key),
  );
  assert.equal(instances[2].destroyed, true);
  assert.deepEqual(binding, { longitude: 114.3, latitude: 30.5, rotation: 21 });
  const previewPending = createBasemap(host, settings, undefined, () => {});
  await new Promise(setImmediate);
  assert.equal("center" in instances[3].options, false);
  instances[3].emit("complete");
  const preview = await previewPending;
  assert.throws(() => preview.project([0, 0]), /确认校园/);
  preview.focus([114.31, 30.51]);
  assert.deepEqual(preview.getCenter(), {
    longitude: 114.31,
    latitude: 30.51,
    rotation: 0,
  });
  assert.equal(preview.getZoom(), 18);
  preview.focus([114.31, 30.51], 14);
  assert.equal(preview.getZoom(), 14);
  preview.setBinding(preview.getCenter());
  assert.doesNotThrow(() => preview.project([0, 0]));
  assert.ok(preview.project([0, 0]).every(Number.isFinite));
  preview.setBinding(undefined);
  assert.throws(() => preview.project([0, 0]), /确认校园/);
  preview.destroy();
  // AMap may emit complete before the adapter can attach a listener.
  const earlyComplete = await createBasemap(host, settings, binding, () => {});
  assert.deepEqual(earlyComplete.getCenter(), {
    longitude: 114.3,
    latitude: 30.5,
    rotation: 0,
  });
  earlyComplete.destroy();
});

test("campus location handles precise/coarse results, permission errors and cancellation", async (t) => {
  const previousWindow = globalThis.window;
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  let callback, options;
  globalThis.window = {
    AMap: {
      plugin(name, ready) {
        assert.equal(name, "AMap.Geolocation");
        ready();
      },
      Geolocation: class {
        constructor(config) {
          options = config;
        }
        getCurrentPosition(cb) {
          callback = cb;
        }
      },
    },
  };
  const exact = locateCampus();
  callback("complete", {
    position: { lng: 114.3, lat: 30.5 },
    accuracy: 15,
    location_type: "html5",
  });
  assert.deepEqual(await exact, {
    position: [114.3, 30.5],
    accuracy: 15,
    approximate: false,
  });
  assert.equal(options.convert, true);
  assert.equal(options.GeoLocationFirst, true);
  assert.equal(options.panToLocation, false);

  const coarse = locateCampus();
  callback("complete", {
    position: { lng: 114.3, lat: 30.5 },
    location_type: "ip",
  });
  assert.equal((await coarse).approximate, true);
  const denied = locateCampus();
  callback("error", { message: "permission denied, secret URL" });
  await assert.rejects(
    denied,
    (error) =>
      error.message.includes("系统定位权限") &&
      !error.message.includes("secret"),
  );
  const invalid = locateCampus();
  callback("complete", { position: { lng: Infinity, lat: 30 } });
  await assert.rejects(invalid, /找到校园/);
  const controller = new AbortController();
  const cancelled = locateCampus(controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  callback("complete", { position: { lng: 114, lat: 30 } }); // Late success must stay ignored.
});
