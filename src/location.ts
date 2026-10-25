import { invoke, isTauri } from "@tauri-apps/api/core";
import { locateCampus as locateWebCampus } from "./amap.ts";
import type { CampusLocation } from "./amap.ts";

interface DevicePosition {
  longitude: number;
  latitude: number;
  accuracy: number;
}
interface LocationBridge {
  desktop(): boolean;
  locate(id: string): Promise<DevicePosition>;
  cancel(id: string): Promise<unknown>;
}
const native: LocationBridge = {
  desktop: isTauri,
  locate: (requestId) => invoke("locate_device", { requestId }),
  cancel: (requestId) => invoke("cancel_device_location", { requestId }),
};

// Desktop permission belongs to the application, not its embedded web page.
// Only the browser preview uses AMap.Geolocation (whose result is already GCJ-02).
export function locateCampus(
  signal?: AbortSignal,
  bridge: LocationBridge = native,
): Promise<CampusLocation> {
  if (!bridge.desktop()) return locateWebCampus(signal);
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const cancel = () => {
      void bridge.cancel(id).catch(() => {});
    };
    const finish = (error?: Error, result?: CampusLocation) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve(result!);
    };
    const aborted = () => {
      cancel();
      finish(new DOMException("已取消定位", "AbortError"));
    };
    if (signal?.aborted) {
      finish(new DOMException("已取消定位", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", aborted, { once: true });
    timer = setTimeout(() => {
      cancel();
      finish(Error("定位超时，请检查系统定位权限，或手动选择校园。"));
    }, 50000);
    bridge
      .locate(id)
      .then((position) => {
        if (finished) return;
        const { longitude, latitude, accuracy } = position;
        if (
          !Number.isFinite(longitude) ||
          !Number.isFinite(latitude) ||
          Math.abs(longitude) > 180 ||
          Math.abs(latitude) > 80 ||
          !Number.isFinite(accuracy) ||
          accuracy < 0
        ) {
          finish(Error("系统未提供有效位置，请手动选择校园。"));
          return;
        }
        // Native Core Location / Windows Geolocator returns WGS-84. Convert exactly once.
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            finish(
              Error(
                "已取得系统位置，但高德坐标转换超时，请检查网络或手动选择校园。",
              ),
            ),
          10000,
        );
        try {
          window.AMap.convertFrom(
            [longitude, latitude],
            "gps",
            (status: string, result: any) => {
              if (finished) return;
              const point = result?.locations?.[0];
              const lng = point?.lng ?? point?.getLng?.();
              const lat = point?.lat ?? point?.getLat?.();
              if (
                status !== "complete" ||
                !Number.isFinite(lng) ||
                !Number.isFinite(lat) ||
                Math.abs(lng) > 180 ||
                Math.abs(lat) > 80
              ) {
                finish(
                  Error(
                    "已取得系统位置，但高德坐标转换失败，请检查网络或手动选择校园。",
                  ),
                );
                return;
              }
              finish(undefined, {
                position: [lng, lat],
                accuracy,
                approximate: accuracy > 100,
              });
            },
          );
        } catch {
          finish(Error("高德坐标转换不可用，请重新连接底图或手动选择校园。"));
        }
      })
      .catch((error: unknown) =>
        finish(
          Error(
            typeof error === "string"
              ? error
              : "系统定位失败，请检查定位权限或手动选择校园。",
          ),
        ),
      );
  });
}

export const canOpenLocationSettings = () => isTauri();
export async function openLocationSettings(): Promise<void> {
  if (isTauri()) await invoke("open_location_settings");
}
