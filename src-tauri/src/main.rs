#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
const LIMIT: usize = 20 * 1024 * 1024;

#[tauri::command]
async fn open_camap() -> Result<Option<Vec<u8>>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("校园地图", &["camap"])
            .pick_file()
        else {
            return Ok(None);
        };
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.len() > LIMIT as u64 {
            return Err("地图文件超过 20 MiB".into());
        }
        std::fs::read(path).map(Some).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_camap(name: String, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.len() > LIMIT {
        return Err("地图文件超过 20 MiB".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let safe_name: String = name
            .chars()
            .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
            .collect();
        let Some(path) = rfd::FileDialog::new()
            .add_filter("校园地图", &["camap"])
            .set_file_name(&safe_name)
            .save_file()
        else {
            return Ok(false);
        };
        // Only the OS picker determines the writable destination; JS cannot pass an arbitrary path.
        let temporary = path.with_extension(format!(
            "camap-{}-{}.tmp",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos()
        ));
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        let result = (|| {
            use std::io::Write;
            f.write_all(&bytes)?;
            f.sync_all()?;
            drop(f);
            std::fs::rename(&temporary, &path)
        })(); // atomic replacement on the same volume
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result.map(|_| true).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_camap, save_camap])
        .run(tauri::generate_context!())
        .expect("无法启动万卷图");
}
