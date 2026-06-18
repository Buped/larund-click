fn main() {
    tauri_build::build();

    // This machine has no rc.exe/llvm-rc/windres/mt.exe, so the app manifest can't
    // be embedded the usual way (the resource step is a clang-cl shim that emits an
    // empty resource). Without the Common-Controls v6 manifest the app fails at
    // startup with STATUS_ENTRYPOINT_NOT_FOUND (TaskDialogIndirect). Ship the
    // manifest as an external `<exe>.manifest` sidecar, which the Windows loader
    // reads for binaries without an embedded manifest. Placed next to the built
    // binary so it survives `cargo clean`.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rerun-if-changed=app.manifest");
        if let Ok(out_dir) = std::env::var("OUT_DIR") {
            // <target>/<triple>/<profile>/build/<pkg>-<hash>/out -> <profile> dir
            if let Some(profile_dir) = std::path::Path::new(&out_dir).ancestors().nth(3) {
                let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("app.manifest");
                for name in ["tauri-app.exe.manifest", "tauri_app.exe.manifest"] {
                    let _ = std::fs::copy(&src, profile_dir.join(name));
                    let _ = std::fs::copy(&src, profile_dir.join("deps").join(name));
                }
            }
        }
    }
}
