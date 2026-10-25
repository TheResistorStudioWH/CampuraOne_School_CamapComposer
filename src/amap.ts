import {
  fromProvider,
  toProvider,
  type Binding,
  type Point,
} from "@campura/camap";
import type { Theme } from "./theme";
declare global {
  interface Window {
    AMap: any;
    _AMapSecurityConfig?: { serviceHost?: string; securityJsCode?: string };
  }
}
export interface MapSettings {
  key: string;
  proxy: string;
  securityCode: string;
}
export interface Basemap {
  project(p: Point): Point;
  unproject(p: Point): Point;
  setBinding(binding: Binding | undefined): void;
  destroy(): void;
  zoom(delta: number): void;
  setTheme(theme: Theme): void;
  getCenter(): Binding;
  getZoom(): number;
  focus(position: Point, zoom?: number): void;
}
let loading: Promise<void> | null = null;
let loadedWith: string | null = null;
const styles = { light: "amap://styles/normal", dark: "amap://styles/dark" };
const connectionHelp =
  "请检查网络、Web 端（JS API）Key、安全密钥和域名白名单；可在「设置底图」重试，或继续使用本地网格。";
const credentials = (s: MapSettings) =>
  JSON.stringify([
    s.key.trim(),
    s.proxy.trim(),
    s.proxy.trim() ? "" : s.securityCode.trim(),
  ]);
export function validateMapSettings(settings: MapSettings) {
  if (!settings.key.trim()) throw Error("请填写高德 Web 端（JS API）Key。");
  if (!settings.proxy.trim() && !settings.securityCode.trim())
    throw Error("请填写配套安全密钥；已有安全代理时也可填写代理地址。");
  if (settings.proxy.trim() && !/^https:\/\//.test(settings.proxy.trim()))
    throw Error("安全代理地址必须使用 HTTPS。");
}
export function mapCredentialsNeedReload(settings: MapSettings): boolean {
  return loadedWith !== null && loadedWith !== credentials(settings);
}

export interface CampusLocation {
  position: Point;
  accuracy?: number;
  approximate: boolean;
}
function checkedPosition(position: any): Point {
  const lng = Number(position?.lng ?? position?.getLng?.());
  const lat = Number(position?.lat ?? position?.getLat?.());
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    Math.abs(lng) > 180 ||
    Math.abs(lat) > 80
  )
    throw Error("未取得有效位置，请在地图上选择校园。");
  return [lng, lat];
}
export function locateCampus(signal?: AbortSignal): Promise<CampusLocation> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error, location?: CampusLocation) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve(location!);
    };
    const aborted = () => finish(new DOMException("已取消定位", "AbortError"));
    const failed = () =>
      finish(
        Error(
          "暂时无法定位。可检查系统定位权限，或拖动、放大地图找到校园后确认。",
        ),
      );
    const timer = setTimeout(failed, 12000);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) {
      aborted();
      return;
    }
    try {
      window.AMap.plugin("AMap.Geolocation", () => {
        if (finished) return;
        try {
          const locator = new window.AMap.Geolocation({
            enableHighAccuracy: true,
            GeoLocationFirst: true,
            timeout: 10000,
            maximumAge: 0,
            convert: true,
            showButton: false,
            showMarker: false,
            showCircle: false,
            panToLocation: false,
            zoomToAccuracy: false,
          });
          locator.getCurrentPosition((status: string, result: any) => {
            if (finished) return;
            if (status !== "complete") {
              failed();
              return;
            }
            try {
              const position = checkedPosition(result.position);
              const accuracy =
                typeof result.accuracy === "number" &&
                Number.isFinite(result.accuracy) &&
                result.accuracy > 0
                  ? result.accuracy
                  : undefined;
              finish(undefined, {
                position,
                accuracy,
                approximate:
                  result.location_type === "ip" ||
                  accuracy === undefined ||
                  accuracy > 100,
              });
            } catch {
              failed();
            }
          });
        } catch {
          failed();
        }
      });
    } catch {
      failed();
    }
  });
}
async function loadAPI(settings: MapSettings) {
  validateMapSettings(settings);
  if (mapCredentialsNeedReload(settings))
    throw Error("地图凭据已修改，请保存配置后重新加载应用。");
  if (window.AMap?.Map) return;
  if (!loading) {
    loadedWith = credentials(settings);
    loading = new Promise<void>((resolve, reject) => {
      window._AMapSecurityConfig = settings.proxy.trim()
        ? { serviceHost: settings.proxy.trim() }
        : { securityJsCode: settings.securityCode.trim() };
      const script = document.createElement("script");
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) {
          script.remove();
          if (!window.AMap?.Map) loadedWith = null;
          reject(error);
        } else resolve();
      };
      const timer = setTimeout(
        () => finish(Error("高德脚本加载超时。" + connectionHelp)),
        15000,
      );
      script.src =
        "https://webapi.amap.com/maps?v=2.0&key=" +
        encodeURIComponent(settings.key.trim());
      script.onload = () =>
        finish(
          window.AMap?.Map
            ? undefined
            : Error("高德未成功初始化。" + connectionHelp),
        );
      script.onerror = () =>
        finish(Error("高德脚本加载失败。" + connectionHelp));
      document.head.append(script);
    }).catch((error) => {
      loading = null;
      throw error;
    });
  }
  await loading;
}
export async function createBasemap(
  element: HTMLElement,
  settings: MapSettings,
  binding: Binding | undefined,
  onMove: () => void,
  theme: Theme = "light",
  signal?: AbortSignal,
): Promise<Basemap> {
  await loadAPI(settings);
  signal?.throwIfAborted();
  // An attempt owns its container so cancellation cannot clear a newer map.
  const container = document.createElement("div");
  container.style.cssText = "width:100%;height:100%";
  element.append(container);
  let map: any;
  try {
    map = new window.AMap.Map(container, {
      viewMode: "2D",
      pitch: 0,
      rotation: 0,
      zoom: binding ? 18 : 12,
      ...(binding ? { center: [binding.longitude, binding.latitude] } : {}),
      rotateEnable: false,
      pitchEnable: false,
      showBuildingBlock: false,
      mapStyle: styles[theme],
    });
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        map.off("complete", ready);
        map.off("error", failed);
        signal?.removeEventListener("abort", aborted);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const failed = (event: any) => {
        cleanup();
        // Only known error codes: raw provider payloads may contain credential URLs.
        const code = String(
          event?.info ?? event?.message ?? event?.type ?? "",
        ).match(
          /\b(?:INVALID_USER_KEY|INVALID_USER_SCODE|INVALID_USER_DOMAIN|USERKEY_PLAT_NOMATCH|USER_DAILY_QUERY_OVER_LIMIT)\b/,
        )?.[0];
        reject(
          Error(
            "高德底图加载失败" +
              (code ? "（" + code + "）" : "") +
              "。" +
              connectionHelp,
          ),
        );
      };
      const aborted = () => {
        cleanup();
        reject(new DOMException("已取消连接", "AbortError"));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(Error("高德底图加载超时。" + connectionHelp));
      }, 25000);
      map.on("complete", ready);
      map.on("error", failed);
      signal?.addEventListener("abort", aborted, { once: true });
      if (signal?.aborted) aborted();
    });
  } catch (error) {
    map?.destroy();
    container.remove();
    throw error;
  }
  map.on("mapmove", onMove);
  map.on("zoomchange", onMove);
  let destroyed = false;
  let currentBinding = binding;
  return {
    project(p) {
      if (!currentBinding) throw Error("请先确认校园位置。");
      const q = map.lngLatToContainer(toProvider(p, currentBinding));
      return [q.x, q.y];
    },
    unproject(p) {
      if (!currentBinding) throw Error("请先确认校园位置。");
      const q = map.containerToLngLat(new window.AMap.Pixel(...p));
      return fromProvider([q.lng, q.lat], currentBinding);
    },
    setBinding(next) {
      currentBinding = next;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      map.destroy();
      container.remove();
    },
    zoom(delta) {
      map.setZoom(map.getZoom() + delta);
    },
    setTheme(next) {
      map.setMapStyle(styles[next]);
    },
    getCenter() {
      const [longitude, latitude] = checkedPosition(map.getCenter());
      return { longitude, latitude, rotation: 0 };
    },
    getZoom() {
      return map.getZoom();
    },
    focus(position, zoom = 18) {
      map.setZoomAndCenter(zoom, position);
    },
  };
}
