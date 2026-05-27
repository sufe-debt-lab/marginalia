# 本机桌面壳与 pi-server 实现计划

> **给 agentic worker：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐步执行本计划。步骤使用 checkbox（`- [ ]`）跟踪进度。

**目标：** 构建第一个可运行的垂直闭环：pnpm workspace、Electron 桌面壳、本机 pi-server 子进程、health endpoint 和 renderer 状态 UI。

**架构：** 仓库改成 pnpm monorepo，包含 `apps/pi-server` 和 `apps/desktop`。Electron main 负责管理 pi-server 子进程，只通过 preload 暴露 server 状态和 URL。Renderer 只通过 HTTP 访问 server，不导入 server 代码。

**技术栈：** pnpm、TypeScript、Vitest、Hono、Electron、Vite、React、Testing Library。

---

## 文件结构

- 修改：`package.json` — 根 workspace scripts。
- 新建：`pnpm-workspace.yaml` — workspace package 发现规则。
- 新建：`tsconfig.base.json` — 共享 TypeScript 默认配置。
- 新建：`.gitignore` — Node/Electron 构建产物忽略规则。
- 新建：`apps/pi-server/package.json` — server package scripts 和依赖。
- 新建：`apps/pi-server/tsconfig.json` — server TypeScript 配置。
- 新建：`apps/pi-server/src/health.ts` — health payload 构造器。
- 新建：`apps/pi-server/src/app.ts` — Hono routes。
- 新建：`apps/pi-server/src/index.ts` — HTTP listener 和启动协议。
- 新建：`apps/pi-server/test/health.test.ts` — health route 测试。
- 新建：`apps/desktop/package.json` — desktop app scripts 和依赖。
- 新建：`apps/desktop/tsconfig.json` — desktop 共享 TS 配置。
- 新建：`apps/desktop/tsconfig.node.json` — Electron main/preload TS 配置。
- 新建：`apps/desktop/vite.config.ts` — renderer 构建配置。
- 新建：`apps/desktop/index.html` — renderer HTML 入口。
- 新建：`apps/desktop/electron/main.ts` — Electron app 生命周期。
- 新建：`apps/desktop/electron/pi-server-spawner.ts` — 子进程管理。
- 新建：`apps/desktop/electron/pi-server-spawner.test.ts` — ready 协议、跨 chunk 解析和错误诊断测试。
- 新建：`apps/desktop/electron/preload.ts` — 暴露给 renderer 的安全 bridge。
- 新建：`apps/desktop/src/test/setup.ts` — renderer 测试初始化。
- 新建：`apps/desktop/src/main.tsx` — React 入口。
- 新建：`apps/desktop/src/App.tsx` — server 状态 UI。
- 新建：`apps/desktop/src/App.test.tsx` — renderer UI 测试。

## TDD 覆盖矩阵

| 功能点 | 先写的失败测试 | 通过标准 |
| --- | --- | --- |
| `/health` | `apps/pi-server/test/health.test.ts` | 返回固定结构的 health metadata。 |
| ready 协议解析 | `apps/desktop/electron/pi-server-spawner.test.ts` | 支持跨 stdout chunk buffering，非法 JSON 返回 `null`，不会 crash。 |
| 启动失败诊断 | `apps/desktop/electron/pi-server-spawner.test.ts` | failed status 包含错误和最近 stdout/stderr 日志。 |
| renderer ready 状态 | `apps/desktop/src/App.test.tsx` | server ready 后 fetch `/health` 并展示 `health ok`。 |
| renderer retry | `apps/desktop/src/App.test.tsx` | failed 状态点击 Retry 会调用 `restartPiServer()` 并回到 starting/ready 状态。 |
| 进程退出 | 手动验证步骤 | 退出 Electron 后 `pi-server` 子进程不存在。 |

## 任务 1：Workspace 工具链

**文件：**
- 修改：`package.json`
- 新建：`pnpm-workspace.yaml`
- 新建：`tsconfig.base.json`
- 新建：`.gitignore`

- [ ] **步骤 1：替换根目录 `package.json`**

```json
{
  "name": "marginalia",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm --filter @marginalia/pi-server build && concurrently -k -n server,desktop \"pnpm --filter @marginalia/pi-server build --watch\" \"pnpm --filter @marginalia/desktop dev\"",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "concurrently": "^9.1.0"
  },
  "packageManager": "pnpm@9.15.4",
  "engines": {
    "node": ">=20.11.0"
  }
}
```

- [ ] **步骤 2：创建 `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **步骤 3：创建 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **步骤 4：创建 `.gitignore`**

```gitignore
node_modules
dist
dist-electron
.vite
.DS_Store
*.log
coverage
```

- [ ] **步骤 5：安装根目录工具链**

运行：`pnpm install`

预期：创建 `pnpm-lock.yaml`，命令以 0 退出。

- [ ] **步骤 6：提交**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore: initialize pnpm workspace"
```

## 任务 2：pi-server Health API

**文件：**
- 新建：`apps/pi-server/package.json`
- 新建：`apps/pi-server/tsconfig.json`
- 新建：`apps/pi-server/src/health.ts`
- 新建：`apps/pi-server/src/app.ts`
- 新建：`apps/pi-server/test/health.test.ts`

- [ ] **步骤 1：创建 `apps/pi-server/package.json`**

```json
{
  "name": "@marginalia/pi-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **步骤 2：安装 server 依赖**

运行：`pnpm install`

预期：安装 `apps/pi-server/package.json` 中声明的依赖。

- [ ] **步骤 3：创建 `apps/pi-server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "test"]
}
```

- [ ] **步骤 4：编写预期失败的 health 测试**

```ts
// apps/pi-server/test/health.test.ts
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("returns server health metadata", async () => {
    const app = createApp({ startedAt: new Date("2026-05-25T00:00:00.000Z") });

    const response = await app.request("/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      service: "pi-server",
      version: "0.1.0",
      startedAt: "2026-05-25T00:00:00.000Z"
    });
  });
});
```

- [ ] **步骤 5：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- health.test.ts`

预期：FAIL，报 `../src/app` import error。

- [ ] **步骤 6：实现 health route**

```ts
// apps/pi-server/src/health.ts
export type HealthInfo = {
  status: "ok";
  service: "pi-server";
  version: string;
  startedAt: string;
};

export function createHealthInfo(startedAt: Date): HealthInfo {
  return {
    status: "ok",
    service: "pi-server",
    version: "0.1.0",
    startedAt: startedAt.toISOString()
  };
}
```

```ts
// apps/pi-server/src/app.ts
import { Hono } from "hono";
import { createHealthInfo } from "./health.js";

export type AppOptions = {
  startedAt?: Date;
};

export function createApp(options: AppOptions = {}) {
  const startedAt = options.startedAt ?? new Date();
  const app = new Hono();

  app.get("/health", (c) => c.json(createHealthInfo(startedAt)));

  return app;
}
```

- [ ] **步骤 7：运行测试确认通过**

运行：`pnpm --filter @marginalia/pi-server test -- health.test.ts`

预期：PASS。

- [ ] **步骤 8：提交**

```bash
git add apps/pi-server package.json pnpm-lock.yaml
git commit -m "feat: add pi-server health endpoint"
```

## 任务 3：pi-server 监听器和启动协议

**文件：**
- 新建：`apps/pi-server/src/index.ts`
- 测试：手动命令验证

- [ ] **步骤 1：实现监听器**

```ts
// apps/pi-server/src/index.ts
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const requestedPort = Number(process.env.PORT ?? "0");
const host = process.env.HOST ?? "127.0.0.1";
const app = createApp();

const server = serve(
  {
    fetch: app.fetch,
    hostname: host,
    port: Number.isFinite(requestedPort) ? requestedPort : 0
  },
  (info) => {
    const payload = {
      host,
      port: info.port,
      url: `http://${host}:${info.port}`
    };
    process.stdout.write(`MARGINALIA_SERVER_READY ${JSON.stringify(payload)}\n`);
  }
);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

- [ ] **步骤 2：添加 Node server 依赖**

运行：`pnpm add --filter @marginalia/pi-server @hono/node-server`

预期：依赖被加入 `apps/pi-server/package.json`。

- [ ] **步骤 3：构建 server**

运行：`pnpm --filter @marginalia/pi-server build`

预期：PASS，并且 `apps/pi-server/dist/index.js` 存在。

- [ ] **步骤 4：验证启动协议**

运行：

```bash
node apps/pi-server/dist/index.js
```

预期输出包含：

```text
MARGINALIA_SERVER_READY {"host":"127.0.0.1","port":
```

用 `Ctrl+C` 停止进程。

- [ ] **步骤 5：提交**

```bash
git add apps/pi-server package.json pnpm-lock.yaml
git commit -m "feat: add pi-server startup protocol"
```

## 任务 4：桌面壳和子进程 spawner

**文件：**
- 新建：`apps/desktop/package.json`
- 新建：`apps/desktop/tsconfig.json`
- 新建：`apps/desktop/tsconfig.node.json`
- 新建：`apps/desktop/vite.config.ts`
- 新建：`apps/desktop/electron/pi-server-spawner.ts`
- 新建：`apps/desktop/electron/main.ts`
- 新建：`apps/desktop/electron/preload.ts`

- [ ] **步骤 1：创建 desktop package**

```json
{
  "name": "@marginalia/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist-electron/main.js",
  "scripts": {
    "build:electron": "tsc -p tsconfig.node.json",
    "dev": "pnpm build:electron && concurrently -k \"vite --host 127.0.0.1\" \"wait-on http://127.0.0.1:5173 && VITE_DEV_SERVER_URL=http://127.0.0.1:5173 electron dist-electron/main.js\"",
    "build": "tsc -p tsconfig.node.json && vite build",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit",
    "postinstall": "electron-rebuild --only better-sqlite3 || true"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^33.2.0",
    "concurrently": "^9.1.0",
    "vite": "^6.0.0",
    "wait-on": "^8.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.7.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

> **postinstall 说明：** Plan 01 阶段还没有 native addon，`electron-rebuild` 会无目标可重编，所以用 `|| true` 兜底；这一步是为 Plan 02 加入 `better-sqlite3` 提前准备，避免那时遇到 Electron Node ABI 与系统 Node ABI 不一致的崩溃。

- [ ] **步骤 2：安装 desktop 依赖**

运行：`pnpm install`

预期：依赖图解析成功。

- [ ] **步骤 3：创建 desktop TypeScript 配置**

```json
// apps/desktop/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]
}
```

```json
// apps/desktop/tsconfig.node.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist-electron",
    "rootDir": "electron",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node", "electron"]
  },
  "include": ["electron/**/*.ts"]
}
```

- [ ] **步骤 4：创建 renderer 测试初始化和 `vite.config.ts`**

```ts
// apps/desktop/src/test/setup.ts
import "@testing-library/jest-dom/vitest";
```

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"]
  }
});
```

- [ ] **步骤 5：编写预期失败的 spawner 单元测试**

```ts
// apps/desktop/electron/pi-server-spawner.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { appendRecentLog, createReadyLineParser, parseReadyLine } from "./pi-server-spawner.js";

describe("pi-server ready protocol", () => {
  it("parses valid ready lines and ignores invalid JSON", () => {
    expect(parseReadyLine("MARGINALIA_SERVER_READY {bad-json")).toBeNull();
    expect(parseReadyLine("other output")).toBeNull();
    expect(parseReadyLine('MARGINALIA_SERVER_READY {"url":"http://127.0.0.1:4321","port":4321}')).toEqual({
      state: "ready",
      url: "http://127.0.0.1:4321",
      port: 4321
    });
  });

  it("buffers stdout chunks until a complete ready line arrives", () => {
    const statuses: unknown[] = [];
    const parser = createReadyLineParser((status) => statuses.push(status));

    parser(Buffer.from('MARGINALIA_SERVER_READY {"url":"http://127.0.0.1:4321",'));
    parser(Buffer.from('"port":4321}\n'));

    expect(statuses).toEqual([{ state: "ready", url: "http://127.0.0.1:4321", port: 4321 }]);
  });

  it("keeps only recent stdout and stderr lines for failed startup diagnostics", () => {
    let logs: string[] = [];
    logs = appendRecentLog(logs, Buffer.from("stdout one\nstdout two\n"), 3);
    logs = appendRecentLog(logs, Buffer.from("stderr one\nstderr two\n"), 3);

    expect(logs).toEqual(["stdout two", "stderr one", "stderr two"]);
  });
});
```

- [ ] **步骤 6：运行 spawner 测试确认失败**

运行：`pnpm --filter @marginalia/desktop test -- pi-server-spawner.test.ts`

预期：FAIL，提示缺少 `./pi-server-spawner.js` 或导出函数。

- [ ] **步骤 7：实现 pi-server spawner**

```ts
// apps/desktop/electron/pi-server-spawner.ts
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import path from "node:path";

export type PiServerStatus =
  | { state: "starting" }
  | { state: "ready"; url: string; port: number }
  | { state: "failed"; error: string; logs: string[] };

export type PiServerHandle = {
  child: ChildProcess;
  ready: Promise<PiServerStatus>;
  stop: () => void;
};

export function parseReadyLine(line: string): PiServerStatus | null {
  const prefix = "MARGINALIA_SERVER_READY ";
  if (!line.startsWith(prefix)) return null;
  try {
    const payload = JSON.parse(line.slice(prefix.length)) as { url?: unknown; port?: unknown };
    if (typeof payload.url !== "string" || typeof payload.port !== "number") return null;
    return { state: "ready", url: payload.url, port: payload.port };
  } catch {
    return null;
  }
}

export function createReadyLineParser(onReady: (status: PiServerStatus) => void) {
  let buffered = "";
  return (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      const status = parseReadyLine(line.trim());
      if (status) onReady(status);
    }
  };
}

export function appendRecentLog(logs: string[], chunk: Buffer, maxLines = 50) {
  const lines = chunk.toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [...logs, ...lines].slice(-maxLines);
}

export function startPiServer(): PiServerHandle {
  const entry = process.env.PI_SERVER_ENTRY ?? path.resolve(process.cwd(), "../pi-server/dist/index.js");
  let logs: string[] = [];
  // 用 spawn + 显式 node 二进制，避免 Electron 内嵌 Node 与 ESM fork 的兼容性问题。
  // 不使用 IPC channel，状态完全通过 stdout 的 MARGINALIA_SERVER_READY 行传递。
  const child = spawn(process.execPath, [entry], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", ELECTRON_RUN_AS_NODE: "1" }
  });

  const ready = new Promise<PiServerStatus>((resolve) => {
    let settled = false;
    const resolveOnce = (status: PiServerStatus) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    const parseReady = createReadyLineParser(resolveOnce);

    child.stdout?.on("data", (chunk: Buffer) => {
      logs = appendRecentLog(logs, chunk);
      parseReady(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      logs = appendRecentLog(logs, chunk);
    });
    child.once("error", (error) => resolveOnce({ state: "failed", error: error.message, logs }));
    child.once("exit", (code) => {
      if (code !== 0) resolveOnce({ state: "failed", error: `pi-server exited with code ${code}`, logs });
    });
  });

  return {
    child,
    ready,
    stop: () => {
      if (!child.killed) child.kill("SIGTERM");
    }
  };
}
```

- [ ] **步骤 8：运行 spawner 测试确认通过**

运行：`pnpm --filter @marginalia/desktop test -- pi-server-spawner.test.ts`

预期：PASS。

- [ ] **步骤 9：实现 Electron main 和 preload**

```ts
// apps/desktop/electron/main.ts
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PiServerStatus } from "./pi-server-spawner.js";
import { startPiServer } from "./pi-server-spawner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let serverStatus: PiServerStatus = { state: "starting" };
let serverHandle: ReturnType<typeof startPiServer> | null = null;

function broadcastPiServerStatus() {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("pi-server-status", serverStatus);
  });
}

function startOrRestartPiServer() {
  serverHandle?.stop();
  serverStatus = { state: "starting" };
  broadcastPiServerStatus();

  serverHandle = startPiServer();
  serverHandle.ready.then((status) => {
    serverStatus = status;
    broadcastPiServerStatus();
  });
}

async function createWindow() {
  startOrRestartPiServer();

  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.resolve(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("get-pi-server-status", () => serverStatus);
ipcMain.handle("restart-pi-server", () => {
  startOrRestartPiServer();
  return serverStatus;
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => serverHandle?.stop());
```

```ts
// apps/desktop/electron/preload.ts
import { contextBridge, ipcRenderer } from "electron";
import type { PiServerStatus } from "./pi-server-spawner.js";

contextBridge.exposeInMainWorld("marginalia", {
  getPiServerStatus: () => ipcRenderer.invoke("get-pi-server-status") as Promise<PiServerStatus>,
  restartPiServer: () => ipcRenderer.invoke("restart-pi-server") as Promise<PiServerStatus>,
  onPiServerStatus: (callback: (status: PiServerStatus) => void) => {
    const listener = (_event: unknown, status: PiServerStatus) => callback(status);
    ipcRenderer.on("pi-server-status", listener);
    return () => ipcRenderer.off("pi-server-status", listener);
  }
});
```

- [ ] **步骤 10：提交**

```bash
git add apps/desktop package.json pnpm-lock.yaml
git commit -m "feat: add desktop shell process bridge"
```

## 任务 5：Renderer 状态 UI

**文件：**
- 新建：`apps/desktop/index.html`
- 新建：`apps/desktop/src/main.tsx`
- 新建：`apps/desktop/src/App.tsx`
- 新建：`apps/desktop/src/App.test.tsx`

- [ ] **步骤 1：编写预期失败的 UI 测试**

```ts
// apps/desktop/src/App.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("shows health after pi-server is ready", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", service: "pi-server", version: "0.1.0", startedAt: "2026-05-25T00:00:00.000Z" })
    }));

    render(<App initialStatus={{ state: "ready", url: "http://127.0.0.1:4321", port: 4321 }} />);

    expect(screen.getByText("Marginalia")).toBeInTheDocument();
    expect(screen.getByText("pi-server ready")).toBeInTheDocument();
    expect(await screen.findByText("health ok")).toBeInTheDocument();
    expect(screen.getByText("Create or open a workspace to begin.")).toBeInTheDocument();
  });

  it("retries failed startup through the preload bridge", async () => {
    const restartPiServer = vi.fn().mockResolvedValue({ state: "starting" });
    render(<App initialStatus={{ state: "failed", error: "boom", logs: ["stderr line"] }} bridge={{ restartPiServer }} />);

    expect(screen.getByText("pi-server failed")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByText("stderr line")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(restartPiServer).toHaveBeenCalledOnce();
    expect(screen.getByText("pi-server starting")).toBeInTheDocument();
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/desktop test -- App.test.tsx`

预期：FAIL，提示缺少 `./App`。

- [ ] **步骤 3：实现 renderer 文件**

```html
<!-- apps/desktop/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Marginalia</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// apps/desktop/src/App.tsx
import { useEffect, useState } from "react";

export type PiServerStatus =
  | { state: "starting" }
  | { state: "ready"; url: string; port: number }
  | { state: "failed"; error: string; logs: string[] };

export type HealthInfo = {
  status: "ok";
  service: string;
  version: string;
  startedAt: string;
};

export type MarginaliaBridge = {
  getPiServerStatus?: () => Promise<PiServerStatus>;
  restartPiServer?: () => Promise<PiServerStatus>;
  onPiServerStatus?: (callback: (status: PiServerStatus) => void) => () => void;
};

declare global {
  interface Window {
    marginalia?: MarginaliaBridge;
  }
}

export function App({
  initialStatus = { state: "starting" },
  bridge = window.marginalia ?? {}
}: {
  initialStatus?: PiServerStatus;
  bridge?: MarginaliaBridge;
}) {
  const [status, setStatus] = useState<PiServerStatus>(initialStatus);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    let unsubscribe = () => {};
    bridge.getPiServerStatus?.().then(setStatus);
    unsubscribe = bridge.onPiServerStatus?.(setStatus) ?? unsubscribe;
    return unsubscribe;
  }, [bridge]);

  useEffect(() => {
    if (status.state !== "ready") {
      setHealth(null);
      return;
    }

    let cancelled = false;
    fetch(`${status.url}/health`)
      .then((response) => response.json() as Promise<HealthInfo>)
      .then((body) => {
        if (!cancelled) setHealth(body);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  async function retry() {
    const nextStatus = await bridge.restartPiServer?.();
    setStatus(nextStatus ?? { state: "starting" });
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>Marginalia</h1>
      {status.state === "starting" && <p>pi-server starting</p>}
      {status.state === "ready" && (
        <section>
          <p>pi-server ready</p>
          <p>{status.url}</p>
          {health && <p>health {health.status}</p>}
          <p>Create or open a workspace to begin.</p>
        </section>
      )}
      {status.state === "failed" && (
        <section>
          <p>pi-server failed</p>
          <pre>{status.error}</pre>
          {status.logs.length > 0 && <pre>{status.logs.join("\n")}</pre>}
          <button type="button" onClick={retry}>Retry</button>
        </section>
      )}
    </main>
  );
}
```

```tsx
// apps/desktop/src/main.tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **步骤 4：运行测试和 typecheck**

运行：

```bash
pnpm --filter @marginalia/desktop test
pnpm --filter @marginalia/desktop typecheck
pnpm --filter @marginalia/pi-server typecheck
```

预期：全部通过。

- [ ] **步骤 5：手动开发验证**

运行：`pnpm dev`

预期：Electron 窗口打开，并显示 `pi-server ready`、`health ok` 和 localhost URL。

- [ ] **步骤 6：手动验证退出清理**

运行：

```bash
pnpm dev
```

关闭 Electron 窗口后运行：

```bash
pgrep -af "apps/pi-server/dist/index.js" || true
```

预期：没有残留的 `pi-server` 子进程。

- [ ] **步骤 7：提交**

```bash
git add apps/desktop package.json pnpm-lock.yaml
git commit -m "feat: show local server status in desktop"
```

## 自检

- 规格覆盖：覆盖 pnpm workspace、Electron + Vite + React、pi-server health、forked server 生命周期、preload bridge、首启空状态和失败展示。
- 占位符扫描：没有使用延后实现的表述。
- 类型一致性：`PiServerStatus` 的 variants 在 spawner、preload 和 renderer 中一致。后续 plan 可以把它移动到 `packages/shared-types`。
