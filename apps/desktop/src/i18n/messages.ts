export const en = {
  common: {
    newChat: "New chat",
    settings: "Settings",
    workspaces: "Workspaces",
    pinned: "Pinned",
    newWorkspace: "New workspace",
    loading: "Loading...",
    noWorkspaces: "No workspaces yet",
    noChats: "No chats",
    untitled: "(untitled)",
    toggleLeftSidebar: "Toggle left sidebar",
    toggleRightPanel: "Toggle right panel",
    sessionInfo: "Session info",
    documentPanel: "Document panel",
    language: "Language",
    english: "English",
    chinese: "中文",
    retry: "Retry",
    selectWorkspace: "Select workspace…",
    newWorkspaceEllipsis: "New workspace…"
  },
  newThread: {
    title: "What should we build?",
    placeholder: "Describe a task, ask, or drop a file…"
  },
  composer: {
    chatPlaceholder: "Type / for commands, @ for files…",
    message: "Message",
    send: "Send",
    addAttachment: "Add attachment",
    remove: "Remove",
    slashClear: "Clear current messages from view",
    slashHelp: "Show keyboard shortcuts",
    slashModel: "Open the model picker"
  },
  chat: {
    noMessages: "No messages yet",
    assistant: "assistant",
    noProvider: "No provider configured"
  },
  settings: {
    title: "Settings",
    navGeneral: "General",
    navProviders: "Providers",
    navMcp: "MCP",
    navSkills: "Skills",
    notImplemented: "Not implemented yet",
    generalSubtitle: "Locale, startup behavior and local storage.",
    languageDesc: "Choose the interface language. Applies after reload.",
    resumeLast: "Resume last session on launch",
    resumeLastDesc: "Off by default — always lands on New chat.",
    piServer: "pi-server",
    healthy: "healthy",
    starting: "starting",
    failed: "failed",
    restart: "Restart",
    dataSection: "Data",
    localData: "Local data",
    export: "Export",
    import: "Import",
    providersTitle: "Providers & Models",
    providersSubtitle: "Manage LLM backends and their default models.",
    addProvider: "Add provider",
    test: "Test",
    edit: "Edit",
    connected: "Connected",
    others: "Others",
    noProviders: "No providers configured",
    fieldName: "Name",
    fieldBaseUrl: "Base URL",
    fieldApiKey: "API key",
    fieldDefaultModel: "Default model",
    cancel: "Cancel",
    save: "Save",
    defaultBadge: "default",
    providerAdded: "Provider added",
    providerAddFailed: "Failed to add provider"
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

type MessageShape<T> = {
  [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]>;
};

export const zh = {
  common: {
    newChat: "新建聊天",
    settings: "设置",
    workspaces: "工作区",
    pinned: "已置顶",
    newWorkspace: "新建工作区",
    loading: "加载中...",
    noWorkspaces: "还没有工作区",
    noChats: "还没有聊天",
    untitled: "（未命名）",
    toggleLeftSidebar: "切换左侧边栏",
    toggleRightPanel: "切换右侧面板",
    sessionInfo: "会话信息",
    documentPanel: "文档面板",
    language: "语言",
    english: "English",
    chinese: "中文",
    retry: "重试",
    selectWorkspace: "选择工作区…",
    newWorkspaceEllipsis: "新建工作区…"
  },
  newThread: {
    title: "我们要做点什么？",
    placeholder: "描述任务、提问，或拖入文件…"
  },
  composer: {
    chatPlaceholder: "输入 / 调用技能、@ 引用文件…",
    message: "消息",
    send: "发送",
    addAttachment: "添加附件",
    remove: "移除",
    slashClear: "清空当前消息视图",
    slashHelp: "显示键盘快捷键",
    slashModel: "打开模型选择器"
  },
  chat: {
    noMessages: "还没有消息",
    assistant: "assistant",
    noProvider: "未配置服务商"
  },
  settings: {
    title: "设置",
    navGeneral: "通用",
    navProviders: "服务商",
    navMcp: "MCP",
    navSkills: "技能",
    notImplemented: "暂未实现",
    generalSubtitle: "语言、启动行为与本地存储。",
    languageDesc: "选择界面显示语言，重新加载后生效。",
    resumeLast: "启动时打开上次的会话",
    resumeLastDesc: "默认关闭——启动一律落到“新对话”。",
    piServer: "pi-server",
    healthy: "健康",
    starting: "启动中",
    failed: "失败",
    restart: "重启",
    dataSection: "数据",
    localData: "本地数据",
    export: "导出",
    import: "导入",
    providersTitle: "服务商与模型",
    providersSubtitle: "管理 LLM 后端及其默认模型。",
    addProvider: "添加服务商",
    test: "测试",
    edit: "编辑",
    connected: "已连接",
    others: "其他",
    noProviders: "还没有配置服务商",
    fieldName: "名称",
    fieldBaseUrl: "Base URL",
    fieldApiKey: "API 密钥",
    fieldDefaultModel: "默认模型",
    cancel: "取消",
    save: "保存",
    defaultBadge: "默认",
    providerAdded: "服务商已添加",
    providerAddFailed: "添加服务商失败"
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
} satisfies MessageShape<typeof en>;

export type Locale = "en" | "zh";
export type Messages = MessageShape<typeof en>;
export const messages: Record<Locale, Messages> = { en, zh };
