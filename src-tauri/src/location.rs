use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

#[derive(Default)]
pub struct LocationState(Mutex<Option<(String, Arc<AtomicBool>)>>);

#[derive(Serialize)]
pub struct Position {
    longitude: f64,
    latitude: f64,
    accuracy: f64,
}

impl Position {
    fn checked(longitude: f64, latitude: f64, accuracy: f64) -> Result<Self, String> {
        if !longitude.is_finite()
            || !latitude.is_finite()
            || !accuracy.is_finite()
            || longitude.abs() > 180.0
            || latitude.abs() > 80.0
            || accuracy < 0.0
        {
            return Err("系统未提供有效位置，请手动选择校园。".into());
        }
        Ok(Self {
            longitude,
            latitude,
            accuracy,
        })
    }
}

#[tauri::command]
pub async fn locate_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocationState>,
    request_id: String,
) -> Result<Position, String> {
    if request_id.is_empty() || request_id.len() > 80 {
        return Err("定位请求无效。".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = state.0.lock().map_err(|_| "定位状态不可用。")?;
        if let Some((_, previous)) = active.replace((request_id.clone(), cancelled.clone())) {
            previous.store(true, Ordering::Relaxed);
        }
    }
    let result = platform::locate(app, cancelled).await;
    let mut active = state.0.lock().map_err(|_| "定位状态不可用。")?;
    if active.as_ref().is_some_and(|(id, _)| id == &request_id) {
        *active = None;
    }
    result
}

#[tauri::command]
pub fn cancel_device_location(state: tauri::State<'_, LocationState>, request_id: String) {
    if let Ok(active) = state.0.lock() {
        if let Some((id, flag)) = active.as_ref() {
            if id == &request_id {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }
}

#[tauri::command]
pub fn open_location_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("/usr/bin/open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices")
        .spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer.exe")
        .arg("ms-settings:privacy-location")
        .spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return Err("请手动打开系统定位设置。".into());
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    result
        .map(|_| ())
        .map_err(|_| "无法打开系统设置，请手动打开隐私与安全性中的定位服务。".into())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::sync::mpsc;
    struct Context {
        sender: mpsc::Sender<Result<Position, String>>,
        cancelled: Arc<AtomicBool>,
    }
    extern "C" {
        fn camap_locate(
            context: usize,
            cancelled: extern "C" fn(usize) -> bool,
            completion: extern "C" fn(usize, i32, f64, f64, f64),
        );
    }
    extern "C" fn is_cancelled(context: usize) -> bool {
        unsafe { &*(context as *const Context) }
            .cancelled
            .load(Ordering::Relaxed)
    }
    extern "C" fn completed(context: usize, code: i32, lng: f64, lat: f64, accuracy: f64) {
        // The native owner calls this exactly once, after stopping updates and its timer.
        let context = unsafe { Box::from_raw(context as *mut Context) };
        let result = match code {
            0 => Position::checked(lng, lat, accuracy),
            1 => Err("macOS 未允许定位。请在「系统设置 → 隐私与安全性 → 定位服务」开启定位服务并允许「万卷图」，然后重新定位。".into()),
            2 => Err("定位超时。请检查网络和 Wi-Fi 是否开启，或手动选择校园。".into()),
            3 => Err("已取消定位。".into()),
            _ => Err("macOS 暂时无法取得位置，请检查网络与定位服务，或手动选择校园。".into()),
        };
        let _ = context.sender.send(result);
    }
    pub async fn locate(
        app: tauri::AppHandle,
        cancelled: Arc<AtomicBool>,
    ) -> Result<Position, String> {
        let (sender, receiver) = mpsc::channel();
        let context = Box::into_raw(Box::new(Context { sender, cancelled })) as usize;
        if app
            .run_on_main_thread(move || unsafe { camap_locate(context, is_cancelled, completed) })
            .is_err()
        {
            unsafe {
                drop(Box::from_raw(context as *mut Context));
            }
            return Err("无法启动 macOS 定位。".into());
        }
        tauri::async_runtime::spawn_blocking(move || receiver.recv())
            .await
            .map_err(|_| "定位任务中断。")?
            .map_err(|_| "定位服务中断。")?
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::{
        sync::mpsc,
        time::{Duration, Instant},
    };
    use windows::{
        Devices::Geolocation::{GeolocationAccessStatus, Geolocator, PositionAccuracy},
        Foundation::TimeSpan,
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    };
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }
    const DENIED: &str = "Windows 未允许定位。请在「设置 → 隐私和安全性 → 位置」（Windows 10 为「隐私 → 位置」）开启位置服务及桌面应用的位置访问，然后重新定位。";
    fn error(e: windows::core::Error) -> String {
        if e.code().0 as u32 == 0x80070005 {
            DENIED.into()
        } else {
            "Windows 无法取得位置，请检查位置服务、网络及设备支持，或手动选择校园。".into()
        }
    }
    pub async fn locate(
        app: tauri::AppHandle,
        cancelled: Arc<AtomicBool>,
    ) -> Result<Position, String> {
        let (sender, receiver) = mpsc::channel();
        // WinRT consent must originate on the foreground application's UI thread.
        app.run_on_main_thread(move || {
            let result = (|| {
                let locator = Geolocator::new().map_err(error)?;
                locator
                    .SetDesiredAccuracy(PositionAccuracy::High)
                    .map_err(error)?;
                let permission = Geolocator::RequestAccessAsync().map_err(error)?;
                Ok::<_, String>((locator, permission))
            })();
            let _ = sender.send(result);
        })
        .map_err(|_| "无法启动 Windows 定位。")?;
        tauri::async_runtime::spawn_blocking(move || {
            // The blocking pool's thread needs its own WinRT apartment.
            unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(error)?;
            let _apartment = Apartment;
            let (locator, permission) = receiver.recv().map_err(|_| "定位服务中断。")??;
            let start = Instant::now();
            // Poll only this one-shot request; cancellation also stops the WinRT operation.
            macro_rules! wait {
                ($op:expr) => {{
                    while $op.Status().map_err(error)? == windows_future::AsyncStatus::Started {
                        if cancelled.load(Ordering::Relaxed) || start.elapsed() > Duration::from_secs(45) {
                            let _ = $op.Cancel();
                            return Err(if cancelled.load(Ordering::Relaxed) {
                                "已取消定位。".into()
                            } else { "定位超时，请检查位置服务或手动选择校园。".into() });
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    if cancelled.load(Ordering::Relaxed) { return Err("已取消定位。".into()); }
                    $op.GetResults().map_err(error)?
                }}
            }
            if wait!(permission) != GeolocationAccessStatus::Allowed { return Err(DENIED.into()); }
            let operation = locator.GetGeopositionAsyncWithAgeAndTimeout(
                TimeSpan { Duration: 0 }, TimeSpan { Duration: 200_000_000 },
            ).map_err(error)?;
            let coordinate = wait!(operation).Coordinate().map_err(error)?;
            let position = coordinate.Point().map_err(error)?.Position().map_err(error)?;
            Position::checked(position.Longitude, position.Latitude, coordinate.Accuracy().map_err(error)?)
        }).await.map_err(|_| "定位任务中断。")?
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::*;
    pub async fn locate(_: tauri::AppHandle, _: Arc<AtomicBool>) -> Result<Position, String> {
        Err("当前系统暂不支持原生定位，请手动选择校园。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_system_coordinates() {
        assert!(Position::checked(114.3, 30.5, 30.0).is_ok());
        assert!(Position::checked(f64::NAN, 30.5, 30.0).is_err());
        assert!(Position::checked(181.0, 30.5, 30.0).is_err());
        assert!(Position::checked(114.3, 30.5, -1.0).is_err());
    }
}
