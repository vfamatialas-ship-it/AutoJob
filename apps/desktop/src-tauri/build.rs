use std::path::Path;

/// 校验 `dist-worker/` 里的 Worker 与本次构建的目标平台一致。
///
/// 为什么需要这道检查：`dist-worker/` 是一个固定路径，Linux 包和 Windows 包
/// 都从这里取 Worker。交叉构建时如果忘了先跑
/// `node scripts/build-worker.mjs --target win-x64`，Tauri 会**若无其事地**
/// 把上一次留下的 Linux Worker 打进 Windows 安装包 —— 装完之后才发现起不来。
///
/// 与其让用户在安装后遇到，不如在构建期就断掉。
fn verify_worker_target() {
    let marker = Path::new("../../../dist-worker/TARGET");
    println!("cargo:rerun-if-changed=../../../dist-worker/TARGET");

    // 没有 dist-worker 时不拦：开发时经常只跑 `cargo check`，不需要 Worker
    let Ok(built_for) = std::fs::read_to_string(marker) else {
        return;
    };
    let built_for = built_for.trim();

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if built_for != target_os {
        panic!(
            "dist-worker/ 里是为「{built_for}」构建的 Worker，本次却在为「{target_os}」打包。\n\
             先运行：node scripts/build-worker.mjs{}",
            if target_os == "windows" {
                " --target win-x64"
            } else {
                ""
            }
        );
    }
}

fn main() {
    verify_worker_target();
    tauri_build::build()
}
