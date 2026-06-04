/* views.jsx — NewThread, Chat, FirstRun
   Globals: NewThreadView, ChatView, FirstRunView, Composer, MessageStream */

/* ── Composer (shared) ──────────────────────────────────────────── */
function Composer({
  placeholder,
  size = 'normal', // 'hero' | 'normal'
  attachments = [], // [{ name, kind: 'json'|'md'|'pdf'|'tsx'|..., thumb?: boolean }]
  model = 'gpt-5.1',
  reasoning = 'Medium',
  permission = 'full', // 'full' | 'ask' | 'readonly'
  draftText = '',
  showSlashMenu = false,
  showMentionMenu = false,
  showModelMenu = false,
  t
}) {
  const isHero = size === 'hero';
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: 'var(--shadow-sm)',
        padding: '12px 14px 8px',
        position: 'relative'
      }}>
      
      {/* attachments row */}
      {attachments.length > 0 &&
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {attachments.map((a, i) => <AttachmentCard key={i} att={a} />)}
        </div>
      }

      {/* textarea */}
      <div
        style={{
          minHeight: isHero ? 80 : attachments.length ? 32 : 44,
          color: draftText ? 'var(--text)' : 'var(--text-subtle)',
          fontSize: isHero ? 15 : 14,
          lineHeight: 1.55,
          paddingBottom: 6,
          whiteSpace: 'pre-wrap'
        }}>
        
        {draftText || placeholder}
      </div>

      {/* slash / mention menus (anchored above) */}
      {showSlashMenu && <SlashMenu t={t} />}
      {showMentionMenu && <MentionMenu t={t} />}

      {/* bottom toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="topbtn" style={{ color: 'var(--text-muted)' }}>
          <Icon name="plus" size={15} />
        </button>
        <PermissionChip mode={permission} t={t} />

        <span style={{ flex: 1 }} />

        <ModelChip model={model} reasoning={reasoning} />
        <button
          className="topbtn"
          style={{
            background: 'var(--text)',
            color: 'var(--bg)',
            width: 28, height: 28, borderRadius: '50%',
            marginLeft: 4
          }}>
          
          <Icon name="arrowUp" size={13} stroke={2} />
        </button>
      </div>

      {showModelMenu && <ModelMenu />}
    </div>);

}

/* Attachment cards — two variants */
function AttachmentCard({ att }) {
  if (att.thumb) {
    return (
      <div style={{
        width: 56, height: 56, borderRadius: 9,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        position: 'relative', overflow: 'hidden', flexShrink: 0
      }}>
        {/* fake page thumbnail — horizontal lines */}
        <div style={{
          position: 'absolute', inset: 6,
          background: `repeating-linear-gradient(to bottom,
            var(--text-faint) 0 1px,
            transparent 1px 4px)`,
          opacity: 0.45
        }} />
        <button style={{
          position: 'absolute', top: 4, right: 4,
          width: 16, height: 16, borderRadius: '50%',
          background: 'rgba(0,0,0,0.78)',
          color: '#fff', border: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Icon name="x" size={9} stroke={2} />
        </button>
      </div>);

  }

  const kindMap = {
    json: { bg: 'oklch(0.96 0.04 60)', fg: 'oklch(0.55 0.16 50)', glyph: '{ }' },
    md: { bg: 'oklch(0.95 0.04 145)', fg: 'oklch(0.50 0.14 145)', glyph: 'MD' },
    tsx: { bg: 'oklch(0.95 0.04 240)', fg: 'oklch(0.50 0.14 240)', glyph: 'TS' },
    py: { bg: 'oklch(0.95 0.04 240)', fg: 'oklch(0.50 0.14 240)', glyph: 'PY' },
    pdf: { bg: 'oklch(0.95 0.04 28)', fg: 'oklch(0.55 0.16 28)', glyph: 'PDF' },
    txt: { bg: 'var(--surface-3)', fg: 'var(--text-muted)', glyph: 'TXT' }
  };
  const k = kindMap[att.kind] || kindMap.txt;
  const label = (att.kind || 'TXT').toUpperCase();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 12px 6px 6px',
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 10, position: 'relative',
      minWidth: 0, maxWidth: 240
    }}>
      <span style={{
        width: 38, height: 38, borderRadius: 8,
        background: k.bg, color: k.fg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--f-mono)', fontWeight: 700,
        fontSize: 11, letterSpacing: '-0.02em',
        flexShrink: 0
      }}>{k.glyph}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontWeight: 500, fontSize: 13,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>{att.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{label}</div>
      </div>
      <button style={{
        position: 'absolute', top: -6, right: -6,
        width: 18, height: 18, borderRadius: '50%',
        background: 'rgba(0,0,0,0.82)',
        color: '#fff', border: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 1px 2px rgba(0,0,0,.2)'
      }}>
        <Icon name="x" size={9} stroke={2.2} />
      </button>
    </div>);

}

function PermissionChip({ mode, t }) {
  const conf = {
    full: { color: 'oklch(0.58 0.17 35)', ico: 'alert', label: t('Full access', 'Full access') },
    ask: { color: 'oklch(0.55 0.15 80)', ico: 'info', label: t('Ask each time', 'Ask each time') },
    readonly: { color: 'var(--text-muted)', ico: 'eye', label: t('Read-only', 'Read-only') }
  }[mode] || { color: 'var(--text-muted)', ico: 'info', label: '' };
  return (
    <button style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 8px', borderRadius: 7,
      background: 'transparent', border: 0,
      color: conf.color, fontWeight: 500, fontSize: 13
    }}>
      <Icon name={conf.ico} size={13} stroke={1.7} />
      <span>{conf.label}</span>
      <Icon name="chevDown" size={10} style={{ opacity: 0.7 }} />
    </button>);

}

function ModelChip({ model, reasoning }) {
  return (
    <button style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '4px 10px', borderRadius: 7,
      background: 'transparent', border: 0,
      color: 'var(--text)', fontSize: 13.5, fontWeight: 500
    }}>
      <span className="mono" style={{ fontWeight: 600 }}>{model}</span>
      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{reasoning}</span>
      <Icon name="chevDown" size={11} style={{ color: 'var(--text-muted)' }} />
    </button>);

}

function ModelMenu() {
  const reasoning = ['Low', 'Medium', 'High', 'Extra High'];
  return (
    <div style={{
      position: 'absolute', bottom: 'calc(100% + 6px)', right: 50,
      width: 240,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, boxShadow: 'var(--shadow-lg)',
      padding: 6, zIndex: 6
    }} data-comment-anchor="a00bfff112-div-201-5">
      <div style={{
        fontSize: 12.5, color: 'var(--text-muted)',
        padding: '6px 10px 6px'
      }}>Reasoning</div>
      {reasoning.map((r) =>
      <div key={r} style={{
        display: 'flex', alignItems: 'center',
        padding: '7px 10px', borderRadius: 7,
        fontSize: 13.5,
        background: r === 'Medium' ? 'var(--surface-2)' : 'transparent'
      }}>
          <span style={{ flex: 1 }}>{r}</span>
          {r === 'Medium' && <Icon name="check" size={12} stroke={2.2} />}
        </div>
      )}
      <div style={{ height: 1, background: 'var(--border-soft)', margin: '6px 4px' }} />
      {['GPT-5.5', 'Speed'].map((s) =>
      <div key={s} style={{
        display: 'flex', alignItems: 'center',
        padding: '7px 10px', borderRadius: 7,
        fontSize: 13.5
      }}>
          <span style={{ flex: 1 }}>{s}</span>
          <Icon name="chevRight" size={11} style={{ color: 'var(--text-muted)' }} />
        </div>
      )}
    </div>);

}

function SlashMenu({ t }) {
  const items = [
  { name: '/paper-reader', desc: t ? t('精读 PDF 并产出结构化笔记', 'Read PDF, output structured notes') : '' },
  { name: '/weekly-report', desc: t ? t('生成周报草稿', 'Generate weekly report') : '' },
  { name: '/spec-reviewer', desc: t ? t('逐条审阅 spec', 'Review spec line-by-line') : '' },
  { name: '/meeting-notes', desc: t ? t('整理会议纪要', 'Tidy up meeting notes') : '' }];

  return (
    <div style={menuStyle(218)}>
      <div style={menuHeader}>SKILLS · 4</div>
      {items.map((it, i) =>
      <div key={i} className="menu-row" style={{ ...menuRow, ...(i === 0 ? menuRowSel : {}) }}>
          <Icon name="skill" size={12} />
          <span style={{ flex: 1 }}>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{it.name}</span>
            <span style={{ display: 'block', color: 'var(--text-subtle)', fontSize: 11.5, marginTop: 1 }}>{it.desc}</span>
          </span>
        </div>
      )}
    </div>);

}

function MentionMenu({ t }) {
  const items = [
  { ico: 'fileText', name: 'docs/rewrite-plan.md', hint: t ? t('当前打开', 'open') : '' },
  { ico: 'fileText', name: 'docs/spec.md' },
  { ico: 'file', name: 'apps/desktop/src/App.tsx' },
  { ico: 'fileText', name: 'AGENTS.md' },
  { ico: 'fileText', name: 'CLAUDE.md' }];

  return (
    <div style={menuStyle(280)}>
      <div style={menuHeader}>FILES · 5</div>
      {items.map((it, i) =>
      <div key={i} className="menu-row" style={{ ...menuRow, ...(i === 0 ? menuRowSel : {}) }}>
          <Icon name={it.ico} size={12} />
          <span className="mono" style={{ fontSize: 11.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</span>
          {it.hint && <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{it.hint}</span>}
        </div>
      )}
    </div>);

}

const menuStyle = (w) => ({
  position: 'absolute', bottom: 'calc(100% + 6px)', left: 14,
  width: w,
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 9, boxShadow: 'var(--shadow-md)',
  padding: 4, zIndex: 5
});
const menuHeader = {
  fontSize: 10, fontWeight: 600, letterSpacing: '.08em',
  color: 'var(--text-faint)', padding: '6px 10px 4px'
};
const menuRow = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 8px', borderRadius: 6,
  color: 'var(--text)'
};
const menuRowSel = { background: 'var(--surface-3)' };

/* ── NewThreadView (empty state hero) ───────────────────────────── */
function NewThreadView({ workspace, branch, hasInput, locale, t }) {
  const heroTitle = t('我们要做点什么？', 'What should we build?');
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '60px 32px 96px'
    }}>
      <div style={{ width: '100%', maxWidth: 660 }}>
        <h1 className="h-display" style={{
          fontSize: 30, fontWeight: 400, margin: '0 0 32px',
          textAlign: 'center', letterSpacing: '-0.02em'
        }}>
          {heroTitle}
        </h1>
        <Composer
          size="hero"
          placeholder={t('描述任务、提问，或拖入文件…', 'Describe a task, ask, or drop a file…')}
          draftText={hasInput ? t(
            '帮我把 docs/rewrite-plan.md 的 PR 排期重写为按周分块的清单，并在每个 PR 末尾标注验收命令。',
            'Rewrite the PR schedule in docs/rewrite-plan.md as a weekly checklist with verification commands.'
          ) : ''}
          model="gpt-5.1"
          reasoning="Medium"
          permission="full"
          t={t} />
        

        <div style={{
          display: 'flex', gap: 8, justifyContent: 'flex-start',
          marginTop: 14, flexWrap: 'wrap'
        }}>
          <button className="chip">
            <Icon name="folder" size={12} />
            <span>{workspace}</span>
            <Icon name="chevDown" size={10} className="chev" />
          </button>
        </div>

        {/* Suggestion / recent prompts row */}
        <div style={{ marginTop: 36 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 11, color: 'var(--text-faint)',
            letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600,
            marginBottom: 10
          }}>
            <span>{t('继续之前的会话', 'Pick up where you left off')}</span>
            <span style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
            { title: t('评审 pi-server 路由层 spec', 'Review pi-server routing spec'), meta: '2h · 14 msgs · gpt-5.1' },
            { title: t('梳理 i18n 字典结构与缺 key 静态校验', 'i18n dictionary + missing-key static check'), meta: '昨天 · 8 msgs · claude-4-sonnet' },
            { title: t('为 MCP adapter 写 POC：fs-mcp 接通', 'MCP adapter POC: connect fs-mcp'), meta: '3d · 21 msgs · gpt-5.1' }].
            map((r, i) =>
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 4px', borderBottom: i < 2 ? '1px solid var(--border-soft)' : 'none',
              cursor: 'default'
            }}>
                <Icon name="message" size={13} style={{ color: 'var(--text-faint)' }} />
                <span style={{ flex: 1, color: 'var(--text)' }}>{r.title}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{r.meta}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>);

}

/* ── ChatView (with streaming) ──────────────────────────────────── */
function ChatView({ state = 'streaming', showModelMenu, t, locale }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <MessageStream state={state} t={t} />
      <div style={{ padding: '12px 24px 18px', borderTop: '1px solid var(--border-soft)', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <Composer
            size="normal"
            placeholder={t('继续追问，输入 / 调用技能、@ 引用文件…', 'Ask for follow-up changes')}
            attachments={[
            { thumb: true },
            { name: 'extensions_config.json', kind: 'json' },
            { name: 'moe-vs-dense-comparison.md', kind: 'md' }]
            }
            model="gpt-5.1"
            reasoning="Medium"
            permission="full"
            showModelMenu={showModelMenu}
            t={t} />
          
        </div>
      </div>
    </div>);

}

function MessageStream({ state, t }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '24px 24px 8px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* user msg */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{
            background: 'var(--surface-3)',
            padding: '10px 14px',
            borderRadius: '14px 14px 4px 14px',
            maxWidth: '78%',
            fontSize: 14, lineHeight: 1.55
          }}>
            {t(
              '帮我把 docs/rewrite-plan.md 的 PR 排期重写为按周分块的清单，并在每个 PR 末尾标注验收命令。',
              'Rewrite the PR schedule in docs/rewrite-plan.md as a weekly checklist with verification commands.'
            )}
          </div>
        </div>

        {/* assistant intro */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 600 }}>
            assistant · gpt-5.1
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.65 }}>
            {t(
              '我先读一下当前的 rewrite-plan.md，然后按周整理 PR 列表，并在每个 PR 末尾追加可复制的验收命令。',
              'First I will read the current rewrite-plan.md, then reorganize the PRs by week and append copy-pasteable verification commands.'
            )}
          </div>
        </div>

        {/* tool call: read */}
        <ToolCard
          status="done"
          ico="fileText"
          title={t('读取文档', 'read_document')}
          subtitle="docs/rewrite-plan.md"
          meta="470 lines · 18 KB" />
        

        {/* tool call: edit (running) */}
        <ToolCard
          status={state === 'streaming' ? 'running' : 'done'}
          ico="diff"
          title={t('编辑文件', 'edit_file')}
          subtitle="docs/rewrite-plan.md"
          meta={state === 'streaming' ? '+38 · −12' : '+38 · −12 · 已应用'} />
        

        {/* assistant streaming reply */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 600 }}>
            assistant
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>
            <p style={{ margin: '0 0 12px' }}>
              {t('已按周拆好。整体保持 5 个 PR 的节奏，每个 PR 内部按"准备/实现/收尾"三步组织，便于独立 review。', 'Done — split by week. Five PRs total, each organized into prep / impl / wrap-up for independent review.')}
            </p>
            <div style={{
              padding: '12px 14px', background: 'var(--code-bg)',
              borderRadius: 8, fontFamily: 'var(--f-mono)', fontSize: 12.5,
              lineHeight: 1.6, whiteSpace: 'pre-wrap',
              border: '1px solid var(--border-soft)', margin: '0 0 12px'
            }}>
{`Week 1 · PR 1 — Tailwind + shadcn 接入 + Zustand store
  preparation:  vendor shadcn button/dialog/popover/dropdown
  impl:         tokens.css + globals; mount Toaster
  verify:       pnpm typecheck && pnpm test

Week 1 · PR 2 — AppShell 替换 + Sidebar + Topbar
  preparation:  electron main: titleBarStyle: 'hiddenInset'
  impl:         drop old WorkspaceShell, mount new shell`}
              {state === 'streaming' && <span className="caret" />}
            </div>
            {state === 'streaming' &&
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
                {t('继续输出…', 'Streaming…')}
              </p>
            }
            {state === 'error' &&
            <ErrorRow t={t} />
            }
          </div>
        </div>
      </div>
    </div>);

}

function ToolCard({ status, ico, title, subtitle, meta }) {
  const statusDot = status === 'running' ? 'pulse' :
  status === 'done' ? 'ok' :
  status === 'failed' ? 'err' : 'idle';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      fontSize: 12.5
    }}>
      <span className={'dot ' + statusDot} />
      <Icon name={ico} size={13} style={{ color: 'var(--text-muted)' }} />
      <span style={{ fontWeight: 500 }}>{title}</span>
      <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{subtitle}</span>
      <span style={{ flex: 1 }} />
      <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 11 }}>{meta}</span>
      <Icon name="chevRight" size={11} style={{ color: 'var(--text-faint)' }} />
    </div>);

}

function ErrorRow({ t }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', marginTop: 8,
      background: 'var(--danger-soft)',
      border: '1px solid var(--danger)',
      borderRadius: 8,
      fontSize: 13, color: 'var(--danger)'
    }}>
      <Icon name="alert" size={14} />
      <span style={{ flex: 1 }}>
        <strong>run_failed</strong> · {t('Anthropic 调用 5xx · 模型超时', 'Anthropic 5xx · model timeout')}
      </span>
      <button className="btn sm" style={{ background: 'var(--surface)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
        <Icon name="rotate" size={12} />
        <span>{t('重试', 'Retry')}</span>
      </button>
    </div>);

}

/* ── FirstRunView (no workspace) ────────────────────────────────── */
function FirstRunView({ t }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 40, gap: 32
    }}>
      <div style={{
        width: 96, height: 96, borderRadius: 22,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-md)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden'
      }}>
        {/* a small original mark — overlapping squares */}
        <span style={{
          position: 'absolute', left: 22, top: 22,
          width: 36, height: 36, borderRadius: 9, background: 'var(--accent)',
          opacity: 0.85
        }} />
        <span style={{
          position: 'absolute', right: 22, bottom: 22,
          width: 36, height: 36, borderRadius: 9, background: 'var(--text)',
          opacity: 0.92
        }} />
      </div>

      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <h1 className="h-display" style={{ fontSize: 26, margin: '0 0 10px', fontWeight: 400, letterSpacing: '-0.02em' }}>
          {t('欢迎使用 pi-cowork', 'Welcome to pi-cowork')}
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
          {t(
            '本地优先的桌面端 AI 文档协作器。在开始前，先选一个工作目录，再配置至少一个模型供应商。',
            'A local-first AI document workspace. Pick a working directory and configure at least one model provider to begin.'
          )}
        </p>
      </div>

      <div style={{
        width: 460, display: 'flex', flexDirection: 'column', gap: 8
      }}>
        <SetupRow done t={t}
        ico="folder" title={t('选择工作目录', 'Pick a workspace folder')}
        desc={t('Marginalia 仅在这个目录内读写文件。', 'pi-cowork only reads / writes inside this folder.')}
        actionDone={t('已选 ~/work/marginalia', 'Set · ~/work/marginalia')} />
        
        <SetupRow t={t}
        ico="key" title={t('添加模型供应商', 'Add a model provider')}
        desc={t('Anthropic / OpenAI / Ollama 任一即可启动。', 'Anthropic, OpenAI, or Ollama — any one is enough.')}
        action={t('打开设置 →', 'Open settings →')} />
        
        <SetupRow t={t} optional
        ico="mcp" title={t('（可选）导入 MCP 模板', '(Optional) Import MCP templates')}
        desc={t('fs-mcp / postgres-mcp / qdrant-mcp 一键导入。', 'fs-mcp / postgres-mcp / qdrant-mcp — one-click import.')}
        action={t('查看模板 →', 'Browse templates →')} />
        
      </div>
    </div>);

}

function SetupRow({ ico, title, desc, action, actionDone, done, optional, t }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '14px 16px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10
    }}>
      <span style={{
        width: 26, height: 26, borderRadius: 7,
        background: done ? 'var(--ok-soft)' : 'var(--surface-3)',
        color: done ? 'var(--ok)' : 'var(--text-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
      }}>
        {done ? <Icon name="check" size={13} stroke={2} /> : <Icon name={ico} size={13} />}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 13.5 }}>{title}</span>
          {optional && <span style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em' }}>optional</span>}
        </div>
        <p style={{ margin: '3px 0 0', color: 'var(--text-muted)', fontSize: 12.5 }}>{desc}</p>
      </div>
      {done ?
      <span className="mono" style={{ color: 'var(--ok)', fontSize: 11.5 }}>{actionDone}</span> :

      <button className="btn sm">{action}</button>
      }
    </div>);

}

Object.assign(window, {
  Composer, NewThreadView, ChatView, FirstRunView, MessageStream, ToolCard
});