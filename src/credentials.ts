import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MapSettings } from "./amap";

export const emptyMapSettings = (): MapSettings => ({
  key: "",
  securityCode: "",
  proxy: "",
});
export async function loadMapCredentials(): Promise<MapSettings | null> {
  return isTauri() ? invoke("load_map_credentials") : null;
}
export async function saveMapCredentials(settings: MapSettings): Promise<void> {
  if (!isTauri())
    throw Error("请在万卷图桌面 App 中保存配置，网页预览不会保存密钥。");
  await invoke("save_map_credentials", {
    settings: {
      key: settings.key.trim(),
      securityCode: settings.securityCode.trim(),
      proxy: settings.proxy.trim(),
    },
  });
}
export async function clearMapCredentials(): Promise<void> {
  if (isTauri()) await invoke("clear_map_credentials");
}
