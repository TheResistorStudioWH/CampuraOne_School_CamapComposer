fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=src/location_macos.m");
        cc::Build::new()
            .file("src/location_macos.m")
            .flag("-fobjc-arc")
            .compile("camap_location");
        println!("cargo:rustc-link-lib=framework=CoreLocation");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
    tauri_build::build()
}
