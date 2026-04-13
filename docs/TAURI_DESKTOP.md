# Tauri 2 桌面壳（最小接入）

## 方案概述

- **不重做产品**：现有 `app/frontend`（Vite + React）构建为静态资源，由 Tauri WebView 加载。
- **开发**：`tauri dev` 时加载 `http://localhost:5173`（与浏览器 `npm run dev` 一致）。
- **生产安装包**：`tauri build` 将 `app/frontend/dist` 打进安装包；窗口打开 `tauri://localhost` 或内嵌 dist（由 Tauri 根据 `frontendDist` 注入）。
- **后端**：FastAPI 仍须**单独启动**（默认 `http://127.0.0.1:8000`）。桌面壳不包含 Python 运行时。

## 前端复用方式

- 源码仍在 `app/frontend/`；`vite build` 输出到 `app/frontend/dist`。
- `App.jsx` 使用 `import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"`；本地可建 `app/frontend/.env`：
  - `VITE_API_URL=http://127.0.0.1:8000`

## Windows 构建前置要求

1. **Rust**：`rustup` + stable toolchain（`rustc --version`）。
2. **Microsoft C++ Build Tools**（或 Visual Studio Build Tools），用于 Windows 链接。
3. **Node.js** + npm（已用于前端）。
4. **WebView2**：Windows 10/11 通常已自带；若缺失，安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。

## 目录接入

```
desktop-doc-execution-studio/
  app/frontend/          # 既有 Vite 前端（不变）
  src-tauri/             # Tauri 壳（新增）
    Cargo.toml
    build.rs
    src/main.rs
    tauri.conf.json
    capabilities/default.json
  package.json           # 根目录：tauri CLI 与脚本
  docs/TAURI_DESKTOP.md  # 本文档
```

## 最小打包步骤

在仓库根目录：

```powershell
cd D:\desktop-doc-execution-studio
npm install
cd app\frontend && npm install && cd ..\..
npm run build
npm run tauri build
```

开发调试（需另开终端启动后端 `uvicorn`）：

```powershell
npm run tauri:dev
```

首次若 `cargo` 下载依赖较慢属正常。若 `tauri.conf.json` 中 `bundle.icon` 为空导致打包警告，可后续添加 `icons/icon.ico` 并在配置中引用。

## 本轮未实现项

- 自动更新、系统托盘、多窗口、安装器签名、将 Python 后端打包进 MSI（均为后续扩展）。
