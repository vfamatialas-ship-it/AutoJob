// AutoJob 桌面端的 Rust 外壳。
//
// 它只做三件事：
//   1. 拉起 Node Worker（sidecar），自动化逻辑全在那边
//   2. 从 Worker 的 stdout 读出端口与令牌，转交给前端
//   3. 退出时确保 Worker 一起结束，不留孤儿进程
//
// 为什么不用 Rust 写自动化：Playwright 与整套语义映射都在 TypeScript 里，
// 用 Rust 重写一遍毫无收益。外壳只负责「装起来像个桌面应用」。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsStr;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

// try_state / path 由 Manager trait 提供，必须显式引入
use tauri::Manager;

/// Worker 的连接信息。前端拿到后才能调用接口。
#[derive(Clone, serde::Serialize)]
struct WorkerInfo {
    port: u16,
    token: String,
}

struct WorkerState {
    info: Mutex<Option<WorkerInfo>>,
    child: Mutex<Option<Child>>,
}

/// 前端启动时调用，拿到 Worker 的地址与令牌。
#[tauri::command]
fn worker_info(state: tauri::State<WorkerState>) -> Result<WorkerInfo, String> {
    state
        .info
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Worker 尚未就绪".to_string())
}

/// 启动 Worker 并等待它报告端口与令牌。
///
/// 握手协议很简单：Worker 在 stdout 打一行
/// `AUTOJOB_WORKER_READY <port> <token>`，这里读到就算就绪。
/// 用 stdout 而不是固定端口，是为了避免端口冲突，也避免令牌落到磁盘上。
fn spawn_worker<S: AsRef<OsStr>>(command: S, args: &[&str]) -> Result<(Child, WorkerInfo), String> {
    let mut child = Command::new(command)
        .args(args)
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 Worker：{e}"))?;

    let stdout = child.stdout.take().ok_or("无法读取 Worker 输出")?;
    let reader = BufReader::new(stdout);

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if let Some(rest) = line.strip_prefix("AUTOJOB_WORKER_READY ") {
            let mut parts = rest.split_whitespace();
            let port: u16 = parts
                .next()
                .and_then(|p| p.parse().ok())
                .ok_or("Worker 返回的端口无效")?;
            let token = parts.next().ok_or("Worker 未返回访问令牌")?.to_string();
            return Ok((child, WorkerInfo { port, token }));
        }
    }

    Err("Worker 未报告就绪状态".to_string())
}

/// 打包后 Worker 可执行文件的位置。
///
/// **不能用相对路径**：安装完成后应用可能从任意目录启动（桌面快捷方式、
/// 开始菜单、`/usr/bin` 软链），`./autojob-worker` 一定找不到。
/// 必须从 Tauri 的 resource 目录解析 —— 那是各平台安装器实际放文件的地方。
fn bundled_worker_path(app: &tauri::App) -> Result<PathBuf, String> {
    let exe = if cfg!(windows) {
        "autojob-worker.exe"
    } else {
        "autojob-worker"
    };
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法定位资源目录：{e}"))?
        .join("worker")
        .join(exe);

    if !path.exists() {
        return Err(format!(
            "安装包内缺少 Worker：{}\n请先运行 node scripts/build-worker.mjs 再打包。",
            path.display()
        ));
    }
    Ok(path)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // 开发时用 pnpm 跑源码，打包后用安装目录里的 Worker
            let (child, info) = if cfg!(debug_assertions) {
                spawn_worker("pnpm", &["--dir", "../..", "worker"])
            } else {
                bundled_worker_path(app).and_then(|path| spawn_worker(path, &[]))
            }
            .unwrap_or_else(|e| {
                eprintln!("启动 Worker 失败：{e}");
                std::process::exit(1);
            });

            app.manage(WorkerState {
                info: Mutex::new(Some(info)),
                child: Mutex::new(Some(child)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![worker_info])
        .on_window_event(|window, event| {
            // 关窗即退出：Worker 持有浏览器进程，留着它会占资源
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<WorkerState>() {
                    if let Ok(mut guard) = state.child.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("AutoJob 启动失败");
}
