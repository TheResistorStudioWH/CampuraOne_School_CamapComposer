use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.campura.camapcomposer.amap";
const ACCOUNT: &str = "map-settings-v1";
const STORE_ERROR: &str = "无法访问系统凭据库，请检查钥匙串或 Windows 凭据管理器的权限。";

// Deliberately has no Debug implementation: never print credential values.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapCredentials {
    key: String,
    security_code: String,
    proxy: String,
}

impl MapCredentials {
    fn normalized(mut self) -> Result<Self, String> {
        self.key = self.key.trim().to_owned();
        self.security_code = self.security_code.trim().to_owned();
        self.proxy = self.proxy.trim().to_owned();
        if self.key.is_empty() || (self.security_code.is_empty() && self.proxy.is_empty()) {
            return Err("请填写 Key 和配套安全密钥，或有效的安全代理地址。".into());
        }
        if self.key.len() > 512 || self.security_code.len() > 512 || self.proxy.len() > 2048 {
            return Err("配置内容过长，请检查输入。".into());
        }
        if [&self.key, &self.security_code, &self.proxy]
            .iter()
            .any(|value| value.chars().any(char::is_control))
        {
            return Err("配置中不能含有控制字符。".into());
        }
        if !self.proxy.is_empty() {
            let valid = tauri::Url::parse(&self.proxy)
                .map(|url| {
                    url.scheme() == "https"
                        && url.host_str().is_some()
                        && url.username().is_empty()
                        && url.password().is_none()
                })
                .unwrap_or(false);
            if !valid {
                return Err("安全代理必须是有效的 HTTPS 地址。".into());
            }
        }
        Ok(self)
    }
}

fn entry() -> Result<keyring::Entry, String> {
    if !cfg!(any(target_os = "macos", target_os = "windows")) {
        return Err("本机凭据保存目前仅支持 macOS 和 Windows。".into());
    }
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| STORE_ERROR.into())
}

#[tauri::command]
pub async fn load_map_credentials() -> Result<Option<MapCredentials>, String> {
    tauri::async_runtime::spawn_blocking(|| match entry()?.get_password() {
        Ok(value) => serde_json::from_str::<MapCredentials>(&value)
            .map_err(|_| "本机地图配置无法读取，请重新填写或清除。".to_owned())
            .and_then(MapCredentials::normalized)
            .map(Some),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(STORE_ERROR.into()),
    })
    .await
    .map_err(|_| STORE_ERROR.to_owned())?
}

#[tauri::command]
pub async fn save_map_credentials(settings: MapCredentials) -> Result<(), String> {
    let settings = settings.normalized()?;
    tauri::async_runtime::spawn_blocking(move || {
        let value =
            serde_json::to_string(&settings).map_err(|_| "无法编码地图配置。".to_owned())?;
        entry()?
            .set_password(&value)
            .map_err(|_| STORE_ERROR.to_owned())
    })
    .await
    .map_err(|_| STORE_ERROR.to_owned())?
}

#[tauri::command]
pub async fn clear_map_credentials() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(STORE_ERROR.into()),
    })
    .await
    .map_err(|_| STORE_ERROR.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Uses a disposable OS credential, never the user's map settings"]
    fn os_store_roundtrip() {
        let account = format!(
            "test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let service = "com.campura.camapcomposer.verification";
        let credential = keyring::Entry::new(service, &account).unwrap();
        assert!(matches!(
            credential.get_password(),
            Err(keyring::Error::NoEntry)
        ));
        credential.set_password("test-only-value-one").unwrap();
        let result = (|| -> Result<(), keyring::Error> {
            let reopened = keyring::Entry::new(service, &account)?;
            assert_eq!(reopened.get_password()?, "test-only-value-one");
            reopened.set_password("test-only-value-two")?;
            assert_eq!(credential.get_password()?, "test-only-value-two");
            Ok(())
        })();
        credential.delete_credential().unwrap();
        assert!(matches!(
            credential.get_password(),
            Err(keyring::Error::NoEntry)
        ));
        result.unwrap();
    }
    #[test]
    fn rejects_invalid_or_document_payloads() {
        assert!(serde_json::from_str::<MapCredentials>(
            r#"{"key":"test","securityCode":"test","proxy":"","features":[]}"#
        )
        .is_err());
        for proxy in [
            "http://example.invalid",
            "https://",
            "https://user:password@example.invalid",
        ] {
            let value = MapCredentials {
                key: "test".into(),
                security_code: "".into(),
                proxy: proxy.into(),
            };
            assert!(value.normalized().is_err());
        }
    }
    #[test]
    fn trims_and_accepts_local_or_proxy_config() {
        for (security_code, proxy) in [
            (" example-code ", ""),
            ("", "https://example.invalid/_AMapService"),
        ] {
            let value = MapCredentials {
                key: " example-key ".into(),
                security_code: security_code.into(),
                proxy: proxy.into(),
            };
            let value = value.normalized().unwrap();
            assert_eq!(value.key, "example-key");
        }
    }
}
