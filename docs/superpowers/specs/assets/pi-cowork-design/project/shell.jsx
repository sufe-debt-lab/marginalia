/* shell.jsx — Icon set, Topbar, Sidebar
   Globals exposed: Icon, Topbar, Sidebar, MOCK */

const { useState } = React;

/* ── Icon set ───────────────────────────────────────────────────────
   Simple line icons, stroke 1.5, 16x16 viewBox by default. */
const ICONS = {
  search: 'M14 14l-2.7-2.7M13 7.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z',
  plus: 'M8 3.5v9M3.5 8h9',
  minus: 'M3.5 8h9',
  x: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5l3 3 6-6',
  chevDown: 'M3.5 6l4.5 4.5L12.5 6',
  chevRight: 'M6 3.5L10.5 8 6 12.5',
  chevLeft: 'M10 3.5L5.5 8 10 12.5',
  arrowUp: 'M8 13V3M3.5 7.5L8 3l4.5 4.5',
  arrowRight: 'M3 8h10M9.5 4.5L13 8l-3.5 3.5',
  arrowLeft: 'M13 8H3M6.5 4.5L3 8l3.5 3.5',
  send: 'M3 13l11-5L3 3v4l6 1-6 1z',
  paperclip: 'M11.5 4.5L5 11a2.1 2.1 0 0 0 3 3l7-7a3.5 3.5 0 0 0-5-5L3 9.5a5 5 0 0 0 7 7l5-5',
  mic: 'M8 2.5a2 2 0 0 0-2 2v3.5a2 2 0 0 0 4 0V4.5a2 2 0 0 0-2-2zM4 8a4 4 0 0 0 8 0M8 12.5v2',
  sidebar: 'M2.5 4h11v8h-11zM6 4v8',
  panelRight: 'M2.5 4h11v8h-11zM10 4v8',
  settings: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 8.7l1.4.4-1 1.7-1.3-.6a4 4 0 0 1-1 .6L9.5 12h-3l-.5-1.3a4 4 0 0 1-1-.6l-1.3.6-1-1.7L4 8.7v-1.4l-1.4-.4 1-1.7 1.3.6a4 4 0 0 1 1-.6L6.5 4h3l.5 1.3a4 4 0 0 1 1 .6l1.3-.6 1 1.7L12 7.3z',
  folder: 'M2 4.5A1.5 1.5 0 0 1 3.5 3h2.7L7.5 4h5A1.5 1.5 0 0 1 14 5.5v6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z',
  folderOpen: 'M2 4.5A1.5 1.5 0 0 1 3.5 3h2.7L7.5 4h5A1.5 1.5 0 0 1 14 5.5V6H2zM14 6L13 12.5H2.5L2 6',
  file: 'M4 2.5h5L12 5.5v8a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5zM9 2.5V5.5H12',
  fileText: 'M4 2.5h5L12 5.5v8a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5zM9 2.5V5.5H12M5.5 8.5h5M5.5 11h3',
  message: 'M2.5 4.5A1.5 1.5 0 0 1 4 3h8a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11h0A1.5 1.5 0 0 1 2.5 9.5z',
  zap: 'M9 1.5L3 9.5h4l-1 5 6-8H8z',
  plugin: 'M5 2.5v2M11 2.5v2M3.5 4.5h9v3a4.5 4.5 0 0 1-9 0zM8 12v1.5',
  hash: 'M6 2.5l-1 11M11 2.5l-1 11M3 6h10M2.5 10h10',
  clock: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13zM8 4.5V8l2.5 1.5',
  rotate: 'M3.5 7.5A4.5 4.5 0 0 1 11.5 5L13 6.5M13 3v3.5H9.5M12.5 8.5A4.5 4.5 0 0 1 4.5 11L3 9.5M3 13V9.5H6.5',
  branch: 'M5 3v8M11 5v3.5a2 2 0 0 1-2 2H5M5 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM5 3.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM11 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  history: 'M3 8a5 5 0 1 0 1.5-3.5M3 2v3h3M8 5v3l2 1.5',
  layers: 'M8 1.5l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7v4M8 4.7v.1',
  alert: 'M8 1.5L1 14h14zM8 6v4M8 12v.1',
  mcp: 'M3 5l5-3 5 3v6l-5 3-5-3zM8 2v12M3 5l5 3 5-3',
  skill: 'M8 1.5l1.8 4.2 4.7.5-3.5 3.1 1 4.5L8 11.5l-4 2.3 1-4.5L1.5 6.2l4.7-.5z',
  sparkle: 'M5 2v3M3.5 3.5h3M11 9v5M9 11.5h4M9 4l1.2 2.8L13 8l-2.8 1.2L9 12l-1.2-2.8L5 8l2.8-1.2z',
  more: 'M3 8h.1M8 8h.1M13 8h.1',
  moreV: 'M8 3h.1M8 8h.1M8 13h.1',
  pin: 'M10.5 2L14 5.5l-2.5 1L9 9l1 4-2-1-1.5 4-1-3.5-4-1 4-1.5-1-2L8 5l.5-2.5z',
  edit: 'M11 2.5l2.5 2.5L5.5 13H3v-2.5zM10 3.5L12.5 6',
  trash: 'M3.5 4.5h9M6 4.5V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5M5 4.5l.5 9a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5l.5-9',
  archive: 'M2 3.5h12v2.5H2zM3 6h10v8H3zM6.5 9h3',
  expand: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  collapse: 'M6 2.5V6H2.5M10 6V2.5H13.5M13.5 10H10v3.5M2.5 10H6v3.5',
  globe: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM1.5 8h13M8 1.5a9 9 0 0 1 0 13M8 1.5a9 9 0 0 0 0 13',
  key: 'M11.5 8a2.5 2.5 0 1 1-2.4-3.1L13 1l1 1-1.5 1.5L14 5l-1.5 1.5L11 5l-1.5 1.5M11.5 8a2.5 2.5 0 0 0-4.8-1',
  database: 'M8 1.5c3.3 0 6 .9 6 2v9c0 1.1-2.7 2-6 2s-6-.9-6-2v-9c0-1.1 2.7-2 6-2zM2 3.5c0 1.1 2.7 2 6 2s6-.9 6-2M2 7.5c0 1.1 2.7 2 6 2s6-.9 6-2M2 11.5c0 1.1 2.7 2 6 2s6-.9 6-2',
  command: 'M5.5 3.5h5v9h-5zM3.5 5.5a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0V5.5zM8.5 5.5a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0V5.5z',
  diff: 'M11 2.5v6M11 11v2M11 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM11 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 2v6a2 2 0 0 0 2 2h2M5 2a1.5 1.5 0 1 1 0 .1z',
  loader: 'M8 1.5v3M8 11.5v3M3.5 3.5l2 2M10.5 10.5l2 2M1.5 8h3M11.5 8h3M3.5 12.5l2-2M10.5 5.5l2-2',
  user: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 14a5 5 0 0 1 10 0',
  bot: 'M4 5.5h8a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 11V7A1.5 1.5 0 0 1 4 5.5zM8 5.5V3M5.5 8.5v.1M10.5 8.5v.1',
  trafficUp: 'M5 7.5L8 4.5l3 3M8 4.5v8',
  trafficDown: 'M5 8.5L8 11.5l3-3M8 11.5v-8',
};

function Icon({ name, size = 14, stroke = 1.5, fill, style, className }) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16"
      fill={fill || 'none'}
      stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      className={'ico ' + (className || '')}
    >
      <path d={d} />
    </svg>
  );
}

/* ── Topbar ─────────────────────────────────────────────────────── */
function Topbar({ title, model = 'gpt-5.1 · medium', showRight = true, leftCollapsed, rightCollapsed, hasInfo }) {
  return (
    <div className="topbar">
      <div className="lights">
        <span className="light r" />
        <span className="light y" />
        <span className="light g" />
      </div>
      <button className={'topbtn' + (leftCollapsed ? '' : ' active')} title="Toggle sidebar">
        <Icon name="sidebar" />
      </button>
      <div className="top-title">
        {title}
        {hasInfo && <button className="topbtn" style={{ marginLeft: 4, display: 'inline-flex' }}><Icon name="info" size={13} /></button>}
      </div>
      <div className="top-right">
        {showRight && (
          <button className={'topbtn' + (rightCollapsed ? '' : ' active')} title="Toggle right panel">
            <Icon name="panelRight" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Sidebar ────────────────────────────────────────────────────── */
function Sidebar({ active = 'new-thread', collapsed = false, locale = 'zh', workspaces, lang }) {
  const t = lang;
  workspaces = workspaces || MOCK.workspaces;

  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
      <div className="sb-section">
        <div className={'sb-item' + (active === 'new-thread' ? ' active' : '')}>
          <Icon name="plus" /><span className="sb-label">{t('新对话', 'New chat')}</span>
        </div>
        <div className="sb-item">
          <Icon name="skill" /><span className="sb-label">{t('技能', 'Skills')}</span>
          <span className="sb-meta">12</span>
        </div>
        <div className="sb-item">
          <Icon name="mcp" /><span className="sb-label">{t('MCP 接入', 'MCP')}</span>
          <span className="sb-meta">3</span>
        </div>
      </div>

      <div className="sb-section" style={{ marginTop: 14, flex: 1, overflow: 'auto', minHeight: 0 }}>
        <div className="sb-section-head" style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{t('工作区', 'Workspaces')}</span>
          <button className="sb-head-add" title={t('添加工作区', 'Add workspace')}>
            <Icon name="plus" size={12} />
          </button>
        </div>
        {workspaces.map((ws) => (
          <Workspace key={ws.id} ws={ws} active={active} t={t} />
        ))}
      </div>

      <div className="sb-footer">
        <div className={'sb-item' + (active === 'settings' ? ' active' : '')} style={{ flex: 1 }}>
          <Icon name="settings" />
          <span className="sb-label">{t('设置', 'Settings')}</span>
        </div>
      </div>
    </aside>
  );
}

function Workspace({ ws, active, t }) {
  return (
    <div style={{ marginBottom: 2 }}>
      <div className="sb-workspace">
        <Icon name="chevDown" size={11} className="chev" />
        <Icon name="folder" size={13} />
        <span className="sb-label">{ws.name}</span>
        {ws.unread && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />}
      </div>
      {ws.expanded !== false && (
        <div className="sb-sessions">
          {ws.sessions.map((s) => (
            <div key={s.id} className={'sb-session' + (s.active ? ' active' : '')}>
              <span className="sb-label">{s.title}</span>
              <span className="sb-meta">{s.when}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Mock data ──────────────────────────────────────────────────── */
const MOCK = {
  workspaces: [
    {
      id: 'mr',
      name: 'marginalia',
      expanded: true,
      sessions: [
        { id: 's1', title: '设计三栏布局', when: '现在', active: true },
        { id: 's2', title: '评审 pi-server spec', when: '2h' },
        { id: 's3', title: '梳理 i18n 字典结构', when: '昨天' },
        { id: 's4', title: '研究 MCP adapter POC', when: '3d' },
      ],
    },
    {
      id: 'rd',
      name: '深度学习论文精读',
      expanded: true,
      sessions: [
        { id: 's5', title: 'RWKV-7 笔记', when: '4h' },
        { id: 's6', title: 'Mamba SSD 推导', when: '2d' },
        { id: 's7', title: 'DeepSeek-V3 复盘', when: '1w' },
      ],
    },
    {
      id: 'wk',
      name: '周报',
      expanded: false,
      sessions: [],
    },
    {
      id: 'pe',
      name: 'pi-ext 调研',
      expanded: false,
      sessions: [],
      unread: true,
    },
  ],

  fileTree: [
    { name: 'apps', kind: 'folder', expanded: true, children: [
      { name: 'desktop', kind: 'folder', expanded: true, children: [
        { name: 'electron', kind: 'folder' },
        { name: 'src', kind: 'folder', expanded: true, children: [
          { name: 'app', kind: 'folder' },
          { name: 'chat', kind: 'folder' },
          { name: 'documents', kind: 'folder' },
          { name: 'sidebar', kind: 'folder' },
          { name: 'App.tsx', kind: 'file', lang: 'tsx' },
          { name: 'main.tsx', kind: 'file', lang: 'tsx' },
        ]},
      ]},
      { name: 'pi-server', kind: 'folder' },
    ]},
    { name: 'packages', kind: 'folder' },
    { name: 'docs', kind: 'folder', expanded: true, children: [
      { name: 'spec.md', kind: 'file', agent: true, lang: 'md' },
      { name: 'roadmap.md', kind: 'file', lang: 'md' },
      { name: 'rewrite-plan.md', kind: 'file', agent: true, lang: 'md', active: true },
    ]},
    { name: 'AGENTS.md', kind: 'file', lang: 'md' },
    { name: 'CLAUDE.md', kind: 'file', lang: 'md' },
    { name: 'README.md', kind: 'file', lang: 'md' },
    { name: 'package.json', kind: 'file', lang: 'json' },
  ],

  providers: [
    { id: 'anthropic', name: 'Anthropic', status: 'ok', models: 7, dot: '#d97757', desc: 'Claude · default' },
    { id: 'openai', name: 'OpenAI', status: 'ok', models: 12, dot: '#10a37f' },
    { id: 'google', name: 'Google', status: 'idle', models: 5, dot: '#4285f4' },
    { id: 'deepseek', name: 'DeepSeek', status: 'ok', models: 3, dot: '#4d6bfe' },
    { id: 'ollama', name: 'Ollama · local', status: 'warn', models: 4, dot: '#000', warn: 'host not reachable' },
    { id: 'siliconflow', name: 'SiliconFlow', status: 'idle', models: 28 },
    { id: 'azure', name: 'Azure OpenAI', status: 'idle', models: 0 },
  ],

  mcp: [
    { id: 'fs', name: 'fs-mcp', transport: 'stdio', tools: 6, status: 'ok', desc: '本地文件夹访问' },
    { id: 'pg', name: 'postgres-mcp', transport: 'stdio', tools: 4, status: 'ok', desc: 'PostgreSQL 查询' },
    { id: 'qdrant', name: 'qdrant-mcp', transport: 'sse', tools: 3, status: 'warn', desc: '向量检索 · 连接超时' },
    { id: 'tavily', name: 'tavily-search', transport: 'http', tools: 2, status: 'idle', desc: 'Web search' },
    { id: 'gh', name: 'github', transport: 'stdio', tools: 12, status: 'ok', desc: '代码托管' },
  ],

  skills: [
    { name: 'paper-reader', desc: '精读 PDF 并产出结构化笔记', enabled: true, source: 'global' },
    { name: 'weekly-report', desc: '把对话整理成本周周报草稿', enabled: true, source: 'workspace' },
    { name: 'spec-reviewer', desc: '逐条审阅 spec 并给出 risks', enabled: true, source: 'global' },
    { name: 'code-walkthrough', desc: '为某文件生成代码讲解笔记', enabled: false, source: 'global' },
    { name: 'meeting-notes', desc: '把粗糙记录改写为会议纪要', enabled: true, source: 'workspace' },
  ],
};

Object.assign(window, { Icon, Topbar, Sidebar, Workspace, MOCK });
