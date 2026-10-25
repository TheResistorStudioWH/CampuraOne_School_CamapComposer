import {
  fromProvider,
  toProvider,
  type Binding,
  type Point,
} from "@campura/camap";
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
  longitude: string;
  latitude: string;
}
export interface Basemap {
  project(p: Point): Point;
  unproject(p: Point): Point;
  destroy(): void;
  zoom(delta: number): void;
}
let loading: Promise<void> | null = null;
export async function createBasemap(
  element: HTMLElement,
  settings: MapSettings,
  binding: Binding,
  onMove: () => void,
): Promise<Basemap> {
  if (!settings.key) throw Error("请填写高德 Web JS Key");
  if (!settings.proxy && !settings.securityCode)
    throw Error("请配置安全代理地址或开发用安全密钥");
  if (settings.proxy && !/^https:\/\//.test(settings.proxy))
    throw Error("安全代理地址必须使用 HTTPS");
  if (!window.AMap) {
    if (!loading)
      loading = new Promise<void>((resolve, reject) => {
        window._AMapSecurityConfig = settings.proxy
          ? { serviceHost: settings.proxy }
          : { securityJsCode: settings.securityCode };
        const script = document.createElement("script");
        script.src =
          "https://webapi.amap.com/maps?v=2.0&key=" +
          encodeURIComponent(settings.key);
        script.onload = () => resolve();
        script.onerror = () => {
          loading = null;
          script.remove();
          reject(Error("高德地图加载失败，请检查网络、Key 和域名白名单"));
        };
        document.head.append(script);
      });
    await loading;
  }
  const map = new window.AMap.Map(element, {
    viewMode: "2D",
    pitch: 0,
    rotation: 0,
    zoom: 18,
    center: [binding.longitude, binding.latitude],
    rotateEnable: false,
    pitchEnable: false,
    showBuildingBlock: false,
  });
  map.on("mapmove", onMove);
  map.on("zoomchange", onMove);
  map.on("complete", onMove);
  return {
    project(p) {
      const ll = toProvider(p, binding),
        q = map.lngLatToContainer(ll);
      return [q.x, q.y];
    },
    unproject(p) {
      const q = map.containerToLngLat(new window.AMap.Pixel(...p));
      return fromProvider([q.lng, q.lat], binding);
    },
    destroy() {
      map.destroy();
    },
    zoom(delta) {
      map.setZoom(map.getZoom() + delta);
    },
  };
}
