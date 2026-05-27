# Codex UI 重写 · PR 1: 工具链与基础设施

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 安装 Tailwind / shadcn / lucide / sonner / Zustand / pierre / react-markdown / highlight.js，建立 store 与 i18n 文件骨架。**本 PR 完成后视觉与功能完全不变**，旧 `App.tsx` + 旧 `WorkspaceShell` 继续工作；只是把底子铺好。

**Architecture:** 加 PostCSS + Tailwind 配置（PR 1 关闭 preflight，避免影响旧 UI），shadcn CLI 把组件源码 vendor 到 `src/components/ui/`，Zustand store 与轻量 i18n 文件建立但暂无组件消费。Electron `hiddenInset` 放到 PR 2，和 Topbar 一起启用。

**Tech Stack:** Tailwind 3.4, PostCSS 8, shadcn/ui (vendored), Radix UI primitives, lucide-react, sonner, Zustand 4, react-markdown 9, remark-gfm 4, highlight.js 11, @pierre/trees beta。

**Spec reference:** `docs/superpowers/specs/2026-05-26-codex-style-electron-gui-design.md` § 工具链 / 依赖, § 数据流（store 字段）, § i18n, § 测试策略。

**Commit gate:** 每个 commit 前必须运行该任务相关测试并通过 `pnpm --filter @marginalia/desktop typecheck`。涉及 UI 的 commit 还要启动 Electron dev 窗口做截图验证；PR 1 只有 Electron smoke 截图，验证旧 UI 无视觉变化。浏览器打开 Vite 页面不能替代截图验收。提交前对照 spec 和本 plan，确认测试覆盖新增行为；如果 spec 或 plan 变更，测试同 commit 更新。

---

## File Structure

新建：
- `apps/desktop/postcss.config.cjs` — PostCSS 配置（Tailwind + autoprefixer）
- `apps/desktop/tailwind.config.ts` — Tailwind 配置（扫描路径、theme 扩展）
- `apps/desktop/components.json` — shadcn CLI 配置
- `apps/desktop/src/lib/cn.ts` — Tailwind 类名合并工具
- `apps/desktop/src/store/app-store.ts` — Zustand store（建立但不被消费）
- `apps/desktop/src/store/app-store.test.ts` — store 单元测试
- `apps/desktop/src/i18n/messages.ts` — 英文 / 中文本地字典
- `apps/desktop/src/i18n/useTranslation.ts` — 轻量 `t(key)` hook
- `apps/desktop/src/i18n/useTranslation.test.tsx` — i18n 单元测试
- `apps/desktop/src/components/ui/button.tsx` — shadcn vendored
- `apps/desktop/src/components/ui/dialog.tsx` — shadcn vendored
- `apps/desktop/src/components/ui/dropdown-menu.tsx` — shadcn vendored
- `apps/desktop/src/components/ui/popover.tsx` — shadcn vendored
- `apps/desktop/src/components/ui/input.tsx` — shadcn vendored
- `apps/desktop/src/components/ui/tabs.tsx` — shadcn vendored
- `apps/desktop/src/components/ui/tooltip.tsx` — shadcn vendored
- `apps/desktop/src/components/ui/scroll-area.tsx` — shadcn vendored
- `apps/desktop/src/components/ui/command.tsx` — shadcn vendored
- `apps/desktop/src/components/ui/sonner.tsx` — shadcn vendored toast

修改：
- `apps/desktop/package.json` — 新增依赖
- `apps/desktop/src/styles.css` — 改为 Tailwind 入口 + CSS 变量 + 全局 `body` 拖拽支持
- `apps/desktop/tsconfig.json` — 添加 `baseUrl` + `paths` 以支持 `@/` 别名
- `apps/desktop/vite.config.ts` — 添加 `resolve.alias` 让 `@/` 解析到 `src/`

---

## Task 1: 安装依赖

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: 在 monorepo 根安装新的运行时依赖**

Run:
```bash
cd /Users/shixy/Desktop/curiosity/my-cowork
pnpm --filter @marginalia/desktop add \
  zustand@^4.5 sonner@^1.5 lucide-react@^0.460 \
  clsx@^2 tailwind-merge@^2 class-variance-authority@^0.7 \
  @radix-ui/react-dialog@^1 @radix-ui/react-dropdown-menu@^2 \
  @radix-ui/react-popover@^1 @radix-ui/react-tabs@^1 \
  @radix-ui/react-tooltip@^1 @radix-ui/react-scroll-area@^1 \
  react-markdown@^9 remark-gfm@^4 highlight.js@^11 \
  @pierre/trees@^1.0.0-beta cmdk@^1
```

Expected: pnpm 显示 "+ N packages"，无 ERR_PNPM_PEER_DEP_ISSUES（如有 React 19 vs 18 警告，可忽略，pierre/trees peer 接受 18.3.1+）。

- [ ] **Step 2: 安装开发依赖（Tailwind 链）**

Run:
```bash
pnpm --filter @marginalia/desktop add -D \
  tailwindcss@^3.4 autoprefixer@^10 postcss@^8 \
  tailwindcss-animate@^1.0.7 @types/highlight.js@^10
```

Expected: 同上，无错误。

- [ ] **Step 3: 验证 lockfile 更新**

Run: `git diff apps/desktop/package.json | head -30`

Expected: 看到 `"dependencies"` 和 `"devDependencies"` 多出上述包。

- [ ] **Step 4: Commit**

Run:
```bash
git add apps/desktop/package.json pnpm-lock.yaml
git commit -m "chore(desktop): add tailwind/shadcn/zustand/pierre dependencies for codex-style UI"
```

---

## Task 2: PostCSS + Tailwind 配置

**Files:**
- Create: `apps/desktop/postcss.config.cjs`
- Create: `apps/desktop/tailwind.config.ts`

- [ ] **Step 1: 写 PostCSS 配置**

Create `apps/desktop/postcss.config.cjs`:

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
```

- [ ] **Step 2: 写 Tailwind 配置**

Create `apps/desktop/tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        }
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ]
      }
    }
  },
  plugins: [animate]
};

export default config;
```

- [ ] **Step 3: 改写 `src/styles.css` 为 Tailwind 入口**

Replace contents of `apps/desktop/src/styles.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 98%;
    --foreground: 220 13% 13%;
    --muted: 220 14% 96%;
    --muted-foreground: 220 9% 46%;
    --popover: 0 0% 100%;
    --popover-foreground: 220 13% 13%;
    --card: 0 0% 100%;
    --card-foreground: 220 13% 13%;
    --border: 220 13% 91%;
    --input: 220 13% 91%;
    --primary: 220 13% 13%;
    --primary-foreground: 0 0% 98%;
    --accent: 220 14% 96%;
    --accent-foreground: 220 13% 13%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 98%;
    --ring: 220 13% 13%;
    --radius: 0.5rem;
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground font-sans antialiased;
    margin: 0;
  }
}

/* Electron window drag region — Topbar 默认 drag，按钮单独 no-drag */
.app-drag {
  -webkit-app-region: drag;
}
.app-no-drag {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 4: 启动 dev 验证 Tailwind 编译通过**

Run: `pnpm --filter @marginalia/desktop dev`

Open: 在浏览器看 http://127.0.0.1:5173 加载有无 CSS 报错。Ctrl+C 退出。

Expected: 控制台无 PostCSS 错误；旧 UI 外观不应变化。若按钮/输入框边框或默认间距变化，说明 preflight 未关闭，需要先修复再继续。

- [ ] **Step 5: Commit**

Run:
```bash
git add apps/desktop/postcss.config.cjs apps/desktop/tailwind.config.ts apps/desktop/src/styles.css
git commit -m "chore(desktop): wire up tailwind + postcss + design tokens"
```

---

## Task 3: TypeScript 路径别名

**Files:**
- Modify: `apps/desktop/tsconfig.json`
- Modify: `apps/desktop/vite.config.ts`

- [ ] **Step 1: 在 tsconfig 中添加 baseUrl + paths**

Replace `apps/desktop/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]
}
```

- [ ] **Step 2: 在 vite 中添加 resolve.alias**

Replace `apps/desktop/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "dist-electron/**", "node_modules/**"]
  }
});
```

- [ ] **Step 3: typecheck 验证**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过，无 path 解析错误。

- [ ] **Step 4: Commit**

Run:
```bash
git add apps/desktop/tsconfig.json apps/desktop/vite.config.ts
git commit -m "chore(desktop): add @/* path alias for tailwind/shadcn layout"
```

---

## Task 4: cn 工具函数

**Files:**
- Create: `apps/desktop/src/lib/cn.ts`
- Create: `apps/desktop/src/lib/cn.test.ts`

- [ ] **Step 1: 写测试**

Create `apps/desktop/src/lib/cn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cn } from "./cn.js";

describe("cn", () => {
  it("merges tailwind classes deduplicating conflicts", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", false, "text-blue-500")).toBe("text-blue-500");
  });

  it("handles falsy values", () => {
    expect(cn("a", null, undefined, "b")).toBe("a b");
  });
});
```

- [ ] **Step 2: 运行测试看失败**

Run: `pnpm --filter @marginalia/desktop test -- cn`

Expected: FAIL — 文件不存在。

- [ ] **Step 3: 写实现**

Create `apps/desktop/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- cn`

Expected: PASS。

- [ ] **Step 5: Commit**

Run:
```bash
git add apps/desktop/src/lib/cn.ts apps/desktop/src/lib/cn.test.ts
git commit -m "feat(desktop): add cn() tailwind class merger"
```

---

## Task 5: 初始化 shadcn CLI 并 vendor 组件

**Files:**
- Create: `apps/desktop/components.json`
- Create: `apps/desktop/src/components/ui/{button,dialog,dropdown-menu,popover,input,tabs,tooltip,scroll-area,command,sonner}.tsx`

- [ ] **Step 1: 创建 shadcn CLI 配置**

Create `apps/desktop/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/styles.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/cn"
  }
}
```

- [ ] **Step 2: 用 shadcn CLI vendor 组件**

Run（在 apps/desktop 目录下）:
```bash
cd apps/desktop
pnpm dlx shadcn@latest add -y button dialog dropdown-menu popover input tabs tooltip scroll-area command sonner
```

Expected: 10 个文件写入 `src/components/ui/`。CLI 可能问 "Which package manager?" → pnpm。如果它要求 "use legacy" 选 no。

- [ ] **Step 3: 验证组件 import 可解析**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过。可能出现：
- 如 `utils` 路径错误：在生成的文件里把 `import { cn } from "@/lib/utils"` 改成 `@/lib/cn`
- 如缺少 `next-themes`（sonner 需要）：手动 `pnpm --filter @marginalia/desktop add next-themes@^0.3`

- [ ] **Step 4: Smoke test：用测试文件验证 Button class 可生成**

Create `apps/desktop/src/components/ui/button.smoke.test.tsx`（本 PR 保留，作为 shadcn smoke test）：

```tsx
import { Button } from "@/components/ui/button.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Button", () => {
  it("renders shadcn button classes", () => {
    render(<Button variant="secondary">Tailwind OK</Button>);
    expect(screen.getByRole("button", { name: "Tailwind OK" })).toHaveClass("bg-secondary");
  });
});
```

Run: `pnpm --filter @marginalia/desktop test -- button.smoke`

- [ ] **Step 5: Commit**

Run:
```bash
pnpm --filter @marginalia/desktop test -- button.smoke
pnpm --filter @marginalia/desktop typecheck
git add apps/desktop/components.json apps/desktop/src/components/ui/ apps/desktop/src/components/ui/button.smoke.test.tsx
git commit -m "chore(desktop): vendor shadcn ui components (button/dialog/popover/...)"
```

---

## Task 6: Zustand app store

**Files:**
- Create: `apps/desktop/src/store/app-store.ts`
- Create: `apps/desktop/src/store/app-store.test.ts`

- [ ] **Step 1: 写测试**

Create `apps/desktop/src/store/app-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store.js";

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      view: "new-thread",
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    });
    localStorage.clear();
  });

  it("starts on new-thread view with no active workspace", () => {
    const s = useAppStore.getState();
    expect(s.view).toBe("new-thread");
    expect(s.locale).toBe("en");
    expect(s.activeWorkspaceId).toBeNull();
  });

  it("switches locale", () => {
    useAppStore.getState().setLocale("zh");
    expect(useAppStore.getState().locale).toBe("zh");
  });

  it("switches view", () => {
    useAppStore.getState().setView("chat");
    expect(useAppStore.getState().view).toBe("chat");
  });

  it("adds and removes context files without duplicates", () => {
    const { addContextFile, removeContextFile } = useAppStore.getState();
    addContextFile("a.ts");
    addContextFile("a.ts");
    addContextFile("b.ts");
    expect(useAppStore.getState().contextFiles).toEqual(["a.ts", "b.ts"]);
    removeContextFile("a.ts");
    expect(useAppStore.getState().contextFiles).toEqual(["b.ts"]);
  });

  it("clears context files", () => {
    const { addContextFile, clearContextFiles } = useAppStore.getState();
    addContextFile("a.ts");
    clearContextFiles();
    expect(useAppStore.getState().contextFiles).toEqual([]);
  });

  it("toggles sidebars", () => {
    const { toggleLeftSidebar, toggleRightPanel } = useAppStore.getState();
    toggleLeftSidebar();
    expect(useAppStore.getState().leftSidebarCollapsed).toBe(true);
    toggleRightPanel();
    expect(useAppStore.getState().rightPanelCollapsed).toBe(true);
  });

  it("setPendingPrompt and consume", () => {
    const { setPendingPrompt } = useAppStore.getState();
    setPendingPrompt("hello");
    expect(useAppStore.getState().pendingPrompt).toBe("hello");
    setPendingPrompt(null);
    expect(useAppStore.getState().pendingPrompt).toBeNull();
  });

  it("persists only the partialize-listed fields", () => {
    const { setActiveWorkspace, setActiveSession, setLocale, toggleLeftSidebar, setPendingPrompt } =
      useAppStore.getState();
    setActiveWorkspace("ws-1");
    setActiveSession("s-1");
    setLocale("zh");
    setPendingPrompt("draft");
    toggleLeftSidebar();
    // wait for persist middleware to flush
    const stored = JSON.parse(localStorage.getItem("my-cowork-app") || "{}");
    const state = stored.state ?? {};
    expect(state.activeWorkspaceId).toBe("ws-1");
    expect(state.locale).toBe("zh");
    expect(state.leftSidebarCollapsed).toBe(true);
    expect(state.activeSessionId).toBeUndefined();
    expect(state.pendingPrompt).toBeUndefined();
    expect(state.view).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试看失败**

Run: `pnpm --filter @marginalia/desktop test -- app-store`

Expected: FAIL — 模块不存在。

- [ ] **Step 3: 写实现**

Create `apps/desktop/src/store/app-store.ts`:

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppView = "new-thread" | "chat" | "settings";

interface AppState {
  view: AppView;
  locale: "en" | "zh";
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  pendingPrompt: string | null;
  contextFiles: string[];
  leftSidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;

  setView: (v: AppView) => void;
  setLocale: (v: "en" | "zh") => void;
  setActiveWorkspace: (id: string | null) => void;
  setActiveSession: (id: string | null) => void;
  setPendingPrompt: (p: string | null) => void;
  addContextFile: (p: string) => void;
  removeContextFile: (p: string) => void;
  clearContextFiles: () => void;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: "new-thread",
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false,

      setView: (v) => set({ view: v }),
      setLocale: (v) => set({ locale: v }),
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      setActiveSession: (id) => set({ activeSessionId: id }),
      setPendingPrompt: (p) => set({ pendingPrompt: p }),
      addContextFile: (p) =>
        set((s) => (s.contextFiles.includes(p) ? s : { contextFiles: [...s.contextFiles, p] })),
      removeContextFile: (p) =>
        set((s) => ({ contextFiles: s.contextFiles.filter((x) => x !== p) })),
      clearContextFiles: () => set({ contextFiles: [] }),
      toggleLeftSidebar: () => set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
      toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed }))
    }),
    {
      name: "my-cowork-app",
      version: 1,
      partialize: (s) => ({
        activeWorkspaceId: s.activeWorkspaceId,
        locale: s.locale,
        leftSidebarCollapsed: s.leftSidebarCollapsed,
        rightPanelCollapsed: s.rightPanelCollapsed
      })
    }
  )
);
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- app-store`

Expected: PASS（8 个用例）。测试需要额外覆盖默认 `locale="en"`、`setLocale("zh")`、persist 中只保留 `locale` 而不保留 `view`。

- [ ] **Step 5: Commit**

Run:
```bash
git add apps/desktop/src/store/app-store.ts apps/desktop/src/store/app-store.test.ts
git commit -m "feat(desktop): add zustand app store with persist partialize"
```

---

## Task 7: i18n 基础设施

**Files:**
- Create: `apps/desktop/src/i18n/messages.ts`
- Create: `apps/desktop/src/i18n/useTranslation.ts`
- Create: `apps/desktop/src/i18n/useTranslation.test.tsx`

- [ ] **Step 1: 写测试**

Create `apps/desktop/src/i18n/useTranslation.test.tsx`:

```tsx
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/store/app-store.js";
import { useTranslation } from "./useTranslation.js";

describe("useTranslation", () => {
  beforeEach(() => {
    useAppStore.setState({ locale: "en" });
    localStorage.clear();
  });

  it("uses English by default", () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t("common.newChat")).toBe("New chat");
  });

  it("switches to Chinese when locale=zh", () => {
    useAppStore.getState().setLocale("zh");
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t("common.newChat")).toBe("新建聊天");
  });
});
```

- [ ] **Step 2: 写 messages**

Create `apps/desktop/src/i18n/messages.ts`:

```ts
export const en = {
  common: {
    newChat: "New chat",
    settings: "Settings",
    workspaces: "Workspaces",
    newWorkspace: "New workspace",
    loading: "Loading...",
    noWorkspaces: "No workspaces yet",
    noChats: "No chats",
    untitled: "(untitled)",
    toggleLeftSidebar: "Toggle left sidebar",
    toggleRightPanel: "Toggle right panel",
    documentPanel: "Document panel",
    language: "Language",
    english: "English",
    chinese: "中文",
    retry: "Retry"
  },
  placeholders: {
    comingNextPr: "Coming next PR",
    documentPanelComing: "Document panel coming in PR 4",
    currentView: "Current view"
  },
  toast: {
    workspaceCreated: "Workspace created",
    createWorkspaceFailed: "Failed to create workspace"
  },
  status: {
    startingServer: "Starting pi-server..."
  }
} as const;

export const zh = {
  common: {
    newChat: "新建聊天",
    settings: "设置",
    workspaces: "工作区",
    newWorkspace: "新建工作区",
    loading: "加载中...",
    noWorkspaces: "还没有工作区",
    noChats: "还没有聊天",
    untitled: "（未命名）",
    toggleLeftSidebar: "切换左侧边栏",
    toggleRightPanel: "切换右侧面板",
    documentPanel: "文档面板",
    language: "语言",
    english: "English",
    chinese: "中文",
    retry: "重试"
  },
  placeholders: {
    comingNextPr: "下一 PR 实现",
    documentPanelComing: "文档面板将在 PR 4 实现",
    currentView: "当前视图"
  },
  toast: {
    workspaceCreated: "工作区已创建",
    createWorkspaceFailed: "创建工作区失败"
  },
  status: {
    startingServer: "正在启动 pi-server..."
  }
} satisfies typeof en;

export type Locale = "en" | "zh";
export type Messages = typeof en;
export const messages: Record<Locale, Messages> = { en, zh };
export type MessageKey = `${keyof Messages & string}.${string}`;
```

- [ ] **Step 3: 写 useTranslation**

Create `apps/desktop/src/i18n/useTranslation.ts`:

```ts
import { messages, type Locale } from "./messages.js";
import { useAppStore } from "@/store/app-store.js";

type DotPath<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPath<T[K]>}`;
}[keyof T & string];

type TranslationKey = DotPath<typeof messages.en>;

function lookup(locale: Locale, key: TranslationKey): string {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages[locale]) as string;
}

export function useTranslation() {
  const locale = useAppStore((s) => s.locale);
  return {
    locale,
    t: (key: TranslationKey) => lookup(locale, key)
  };
}
```

- [ ] **Step 4: 测试通过**

Run:
```bash
pnpm --filter @marginalia/desktop test -- useTranslation
pnpm --filter @marginalia/desktop typecheck
```

Expected: PASS，且 `zh satisfies typeof en` 能保证中文字典 key 完整。

- [ ] **Step 5: Commit**

Run:
```bash
pnpm --filter @marginalia/desktop test -- useTranslation
pnpm --filter @marginalia/desktop typecheck
git add apps/desktop/src/i18n/messages.ts apps/desktop/src/i18n/useTranslation.ts apps/desktop/src/i18n/useTranslation.test.tsx
git commit -m "feat(desktop): add lightweight en/zh i18n foundation"
```

---

## Task 8: 添加 toaster 到 main.tsx 入口（为下个 PR 准备）

**Files:**
- Modify: `apps/desktop/src/main.tsx`

- [ ] **Step 1: 在 root 渲染中挂载 Toaster**

Replace `apps/desktop/src/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner.js";
import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <Toaster position="bottom-right" />
  </>
);
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过。

- [ ] **Step 3: dev 验证无报错**

Run: `pnpm --filter @marginalia/desktop dev`

Expected: 旧 UI 渲染如常，浏览器控制台无错误。Ctrl+C 退出。

- [ ] **Step 4: Commit**

Run:
```bash
git add apps/desktop/src/main.tsx
git commit -m "chore(desktop): mount sonner toaster at app root"
```

---

## Task 9: 完整测试 + typecheck

- [ ] **Step 1: 跑全套测试**

Run: `pnpm --filter @marginalia/desktop test`

Expected: 所有测试通过（包括原有的 + 新增的 cn、app-store）。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过。

- [ ] **Step 3: 启动 dev 烟测**

Run: `pnpm --filter @marginalia/desktop dev`

操作：
1. 等窗口出现
2. 点 "Quick chat" 按钮 — 应正常工作（旧逻辑）
3. 创建 workspace — 应正常工作
4. 任意一条 chat — 应正常工作
5. 使用 Electron 窗口截图保存 PR 1 smoke 结果，确认旧 UI 没有 Tailwind preflight 导致的按钮/输入框样式变化

Expected: 所有旧功能不变。视觉上按钮/输入框的边框、默认间距、标题栏都不应变化；`hiddenInset` 尚未启用。

Ctrl+C 退出。

---

## Definition of Done

- [ ] 所有 9 个任务完成且每步 commit
- [ ] `pnpm --filter @marginalia/desktop test` 全绿
- [ ] `pnpm --filter @marginalia/desktop typecheck` 通过
- [ ] `pnpm --filter @marginalia/desktop dev` 启动后旧 UI 仍可使用
- [ ] i18n 基础测试覆盖英文默认值、中文切换、字典 key 完整性
- [ ] 每个 commit 前完成相关 TDD 测试、typecheck、spec/测试对照检查
- [ ] PR 1 Electron smoke 截图已保存，确认旧 UI 无视觉变化
- [ ] `git log` 显示约 8 个 commit
- [ ] 工作树干净（`git status` 无未提交）

下一 PR：`docs/superpowers/plans/2026-05-26-codex-ui-02-shell-sidebar.md`
