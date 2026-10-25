import { encodeCamap, decodeCamap, type CamapDocument } from "@campura/camap";
import { invoke, isTauri } from "@tauri-apps/api/core";
export async function openDocument(): Promise<CamapDocument | null> {
  if (isTauri()) {
    const bytes = await invoke<number[] | null>("open_camap");
    return bytes ? decodeCamap(new Uint8Array(bytes)) : null;
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".camap";
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      try {
        const f = input.files?.[0];
        if (f && f.size > 20 * 1024 * 1024) throw Error("文件超过 20 MiB");
        resolve(
          f ? await decodeCamap(new Uint8Array(await f.arrayBuffer())) : null,
        );
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}
export async function saveDocument(doc: CamapDocument): Promise<boolean> {
  const bytes = await encodeCamap(doc),
    name = doc.title.replace(/[\\/:*?"<>|]/g, "_") + ".camap";
  if (isTauri())
    return invoke<boolean>("save_camap", { name, bytes: Array.from(bytes) });
  const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes).buffer], {
        type: "application/vnd.campura.camap",
      }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return true;
}
