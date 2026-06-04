/* doc-panel.jsx — Right-side document panel
   Globals: DocPanel, FileTree */

function DocPanel({ mode = 'tree', t }) {
  // mode: 'tree' (no file open) | 'split' (file open, tree as narrow col) | 'drawer' (tree drawer + content)
  return (
    <aside style={{
      width: 388, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg)',
      borderLeft: '1px solid var(--border-soft)',
      minHeight: 0,
    }}>
      <DocPanelHeader t={t} mode={mode} />
      {mode === 'tree' && <DocTreeFull t={t} />}
      {mode === 'split' && <DocSplit t={t} narrowTree />}
      {mode === 'drawer' && <DocSplit t={t} drawer />}
    </aside>
  );
}

function DocPanelHeader({ t, mode }) {
  const tabs = mode === 'tree'
    ? []
    : mode === 'drawer'
    ? [
        { name: 'rewrite-plan.md', active: true, agent: true },
        { name: 'AGENTS.md' },
        { name: 'App.tsx' },
        { name: 'spec.md' },
      ]
    : [
        { name: 'rewrite-plan.md', active: true, agent: true },
        { name: 'AGENTS.md' },
      ];

  return (
    <div style={{
      flexShrink: 0,
      borderBottom: '1px solid var(--border-soft)',
    }}>
      {/* Tabs row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        height: 38, padding: '0 8px', overflow: 'hidden',
      }}>
        {tabs.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 8px', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 500,
          }}>
            <Icon name="folder" size={13} />
            <span>marginalia</span>
            <span className="t-faint">·</span>
            <span>{t('文件', 'Files')}</span>
          </div>
        ) : (
          tabs.map((tab, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '0 10px', height: 28,
              background: tab.active ? 'var(--surface)' : 'transparent',
              border: tab.active ? '1px solid var(--border)' : '1px solid transparent',
              borderBottom: tab.active ? '1px solid var(--surface)' : '1px solid transparent',
              borderRadius: '7px 7px 0 0',
              marginBottom: -1,
              fontSize: 12, color: tab.active ? 'var(--text)' : 'var(--text-muted)',
              maxWidth: 140, overflow: 'hidden',
            }}>
              {tab.agent && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />}
              <Icon name="fileText" size={11} style={{ color: 'var(--text-faint)' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.name}</span>
              {tab.active && <Icon name="x" size={10} style={{ color: 'var(--text-faint)', marginLeft: 2 }} />}
            </div>
          ))
        )}
        <span style={{ flex: 1 }} />
        <button className="topbtn"><Icon name="plus" size={13} /></button>
        <button className="topbtn"><Icon name="expand" size={13} /></button>
      </div>

      {/* Path / breadcrumb row (only when a file is open) */}
      {mode !== 'tree' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderTop: '1px solid var(--border-soft)',
          fontSize: 11.5, color: 'var(--text-muted)',
          background: 'var(--surface-2)',
        }}>
          <Icon name="folderOpen" size={11} />
          <span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            docs/rewrite-plan.md
          </span>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
          <span style={{ fontSize: 10.5, color: 'var(--text-faint)', letterSpacing: '.04em' }}>{t('Agent 创建', 'agent-output')}</span>
          <span style={{ width: 1, height: 11, background: 'var(--border)', margin: '0 4px' }} />
          <button className="topbtn" style={{ width: 22, height: 20 }}><Icon name="rotate" size={11} /></button>
          <button className="topbtn" style={{ width: 22, height: 20 }}><Icon name="folderOpen" size={11} /></button>
        </div>
      )}
    </div>
  );
}

function DocTreeFull({ t }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Filter */}
      <div style={{ padding: '10px 12px 6px' }}>
        <div className="sb-search" style={{ margin: 0 }}>
          <Icon name="search" size={12} />
          <span style={{ flex: 1, color: 'var(--text-subtle)' }}>{t('过滤文件…', 'Filter files…')}</span>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 6px 12px' }}>
        <FileTree nodes={MOCK.fileTree} />
      </div>

      <div style={{
        flexShrink: 0, padding: '10px 14px',
        borderTop: '1px solid var(--border-soft)',
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11.5, color: 'var(--text-faint)',
      }}>
        <Icon name="info" size={11} />
        <span>{t('38 个文件 · 仅本地索引', '38 files · local index only')}</span>
      </div>
    </div>
  );
}

function DocSplit({ t, narrowTree, drawer }) {
  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* Tree column */}
      <div style={{
        width: narrowTree ? 168 : 200,
        flexShrink: 0,
        borderRight: '1px solid var(--border-soft)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--surface-2)',
        minHeight: 0,
      }}>
        <div style={{ padding: '8px 10px 6px' }}>
          <div className="sb-search" style={{ margin: 0, padding: '4px 8px', background: 'var(--surface)' }}>
            <Icon name="search" size={11} />
            <span style={{ flex: 1, color: 'var(--text-subtle)', fontSize: 11.5 }}>{t('过滤', 'Filter')}</span>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 4px 8px' }}>
          <FileTree nodes={MOCK.fileTree} compact />
        </div>
      </div>

      {/* Viewer */}
      <DocViewer t={t} />
    </div>
  );
}

function DocViewer({ t }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px 24px', fontSize: 12.5, lineHeight: 1.7, minWidth: 0 }}>
      <h1 className="h-display" style={{ fontSize: 19, margin: '0 0 4px', fontWeight: 500 }}>
        rewrite-plan.md
      </h1>
      <div style={{ color: 'var(--text-faint)', fontSize: 11, marginBottom: 16 }}>
        <span className="mono">5 PRs · 470 lines · {t('版本 v12', 'rev v12')}</span>
      </div>

      <h2 className="h-display" style={{ fontSize: 15, fontWeight: 600, margin: '14px 0 6px' }}>
        Week 1
      </h2>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>PR 1 — Tailwind + shadcn 接入</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)' }}>
          <li>vendor shadcn <span className="mono" style={{ color: 'var(--text)' }}>button / dialog / popover / dropdown</span></li>
          <li>tokens.css + globals; mount Toaster</li>
          <li>preflight 暂时关闭，不改任何视觉</li>
        </ul>
        <pre style={{
          margin: '8px 0 0', padding: '8px 10px',
          background: 'var(--code-bg)', border: '1px solid var(--border-soft)',
          borderRadius: 6, fontFamily: 'var(--f-mono)', fontSize: 11.5,
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
{`pnpm --filter @marginalia/desktop typecheck
pnpm --filter @marginalia/desktop test`}
        </pre>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>PR 2 — AppShell + Sidebar + Topbar</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)' }}>
          <li>electron main: <span className="mono" style={{ color: 'var(--text)' }}>titleBarStyle: 'hiddenInset'</span></li>
          <li>drop old WorkspaceShell + ChatView + DocumentPanel</li>
          <li>主区域先放 <span className="mono" style={{ color: 'var(--text)' }}>&lt;MainPlaceholder /&gt;</span></li>
        </ul>
      </div>

      <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid var(--border-soft)', display: 'flex', gap: 8 }}>
        <button className="btn">
          <Icon name="paperclip" size={12} />
          <span>{t('附加到对话', 'Attach to chat')}</span>
        </button>
        <button className="btn ghost">
          <Icon name="edit" size={12} />
          <span>{t('编辑', 'Edit')}</span>
        </button>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', alignSelf: 'center' }}>
          markdown · 18 KB
        </span>
      </div>
    </div>
  );
}

function FileTree({ nodes, depth = 0, compact }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {nodes.map((n, i) => (
        <FileNode key={i} node={n} depth={depth} compact={compact} />
      ))}
    </div>
  );
}

function FileNode({ node, depth, compact }) {
  const pad = 8 + depth * (compact ? 10 : 12);
  const isFolder = node.kind === 'folder';
  const expanded = node.expanded;
  const active = node.active;

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: `${compact ? 3 : 4}px ${compact ? 6 : 8}px 3px ${pad}px`,
        borderRadius: 5,
        background: active ? 'var(--select)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-muted)',
        fontSize: compact ? 11.5 : 12,
        cursor: 'default',
        position: 'relative',
      }}>
        {isFolder ? (
          <Icon name={expanded ? 'chevDown' : 'chevRight'} size={9} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        ) : (
          <span style={{ width: 9, flexShrink: 0 }} />
        )}
        <Icon
          name={isFolder ? (expanded ? 'folderOpen' : 'folder') : 'file'}
          size={11}
          style={{ color: isFolder ? 'var(--text-subtle)' : 'var(--text-faint)', flexShrink: 0 }}
        />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
        {node.agent && (
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'var(--accent)', flexShrink: 0,
          }} />
        )}
      </div>
      {isFolder && expanded && node.children && (
        <FileTree nodes={node.children} depth={depth + 1} compact={compact} />
      )}
    </>
  );
}

Object.assign(window, { DocPanel, FileTree });
