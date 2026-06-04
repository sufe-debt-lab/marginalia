/* settings.jsx — Settings views (Providers, Models, MCP, Skills, About)
   Globals: SettingsView */

function SettingsView({ tab = 'general', t, setLocale, locale }) {
  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* Vertical nav */}
      <nav style={{
        width: 200, flexShrink: 0,
        borderRight: '1px solid var(--border-soft)',
        padding: '20px 12px',
        display: 'flex', flexDirection: 'column', gap: 1,
      }}>
        <div style={{
          fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--text-faint)',
          padding: '6px 10px 8px',
        }}>{t('设置', 'Settings')}</div>
        {[
          { id: 'general',   ico: 'settings', label: t('通用', 'General') },
          { id: 'providers', ico: 'key',      label: t('服务商', 'Providers') },
          { id: 'mcp',       ico: 'mcp',      label: t('MCP', 'MCP') },
          { id: 'skills',    ico: 'skill',    label: t('技能', 'Skills') },
        ].map((it) => (
          <div key={it.id} className={'sb-item' + (it.id === tab ? ' active' : '')}>
            <Icon name={it.ico} size={13} />
            <span className="sb-label">{it.label}</span>
          </div>
        ))}
      </nav>

      <div style={{ flex: 1, overflow: 'auto', padding: '28px 36px 40px', minWidth: 0 }}>
        {tab === 'general' && <GeneralPane t={t} locale={locale} setLocale={setLocale} />}
        {tab === 'providers' && <ProvidersPane t={t} />}
        {tab === 'mcp' && <McpPane t={t} />}
        {tab === 'skills' && <SkillsPane t={t} />}
      </div>
    </div>
  );
}

function GeneralPane({ t, locale, setLocale }) {
  return (
    <>
      <PaneHeader
        title={t('通用', 'General')}
        subtitle={t('语言、启动行为与本地存储。', 'Locale, startup behavior and local storage.')}
      />

      <SettingCard>
        <SettingRow
          title={t('语言', 'Language')}
          desc={t('选择界面显示语言。重启后对所有窗口生效。', 'Choose the interface language. Applies to all windows after reload.')}
          control={
            <div style={{ display: 'flex', gap: 4, padding: 2, background: 'var(--surface-3)', borderRadius: 7 }}>
              {[
                { v: 'zh', label: '中文' },
                { v: 'en', label: 'English' },
              ].map((o) => (
                <button key={o.v} onClick={() => setLocale && setLocale(o.v)}
                  className="btn sm" style={{
                    background: locale === o.v ? 'var(--surface)' : 'transparent',
                    boxShadow: locale === o.v ? 'var(--shadow-sm)' : 'none',
                    border: 'none', height: 24,
                  }}>{o.label}</button>
              ))}
            </div>
          } />
        <SettingRow
          title={t('启动时打开上次的会话', 'Resume last session on launch')}
          desc={t('默认关闭——启动一律落到"新对话"。', 'Off by default — always lands on "New chat".')}
          control={<Toggle on={false} />} />
        <SettingRow
          title={t('启动 pi-server', 'Start pi-server')}
          desc={<>
            <span className="dot ok" style={{ display: 'inline-block', verticalAlign: '0', marginRight: 6 }} />
            <span className="mono" style={{ fontSize: 11.5 }}>127.0.0.1:51847</span>
            <span className="t-faint" style={{ margin: '0 6px' }}>·</span>
            {t('健康', 'healthy')} · 14ms
          </>}
          control={<button className="btn sm"><Icon name="rotate" size={11} /><span>{t('重启', 'Restart')}</span></button>}
          last />
      </SettingCard>

      <SectionLabel t={t}>{t('数据', 'Data')}</SectionLabel>
      <SettingCard>
        <SettingRow
          title={t('本地数据', 'Local data')}
          desc={<><span className="mono">~/.marginalia/db.sqlite</span> · 14 MB · 38 sessions</>}
          control={
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn sm"><span>{t('导出', 'Export')}</span></button>
              <button className="btn sm"><span>{t('导入', 'Import')}</span></button>
            </div>
          }
          last />
      </SettingCard>
    </>
  );
}

function SettingCard({ children }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden', marginBottom: 20,
    }}>{children}</div>
  );
}

function SectionLabel({ t, children }) {
  return (
    <h2 className="h-display" style={{
      fontSize: 13, fontWeight: 600, margin: '24px 0 10px',
      color: 'var(--text-muted)', letterSpacing: '.04em', textTransform: 'uppercase',
    }}>{children}</h2>
  );
}

function SettingRow({ title, desc, control, divider = true, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '14px 16px',
      borderBottom: !last ? '1px solid var(--border-soft)' : 'none',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        <div style={{ marginTop: 3, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

function PaneHeader({ title, subtitle, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 16,
      paddingBottom: 18,
      borderBottom: '1px solid var(--border-soft)',
      marginBottom: 22,
    }}>
      <div style={{ flex: 1 }}>
        <h1 className="h-display" style={{ fontSize: 22, fontWeight: 500, margin: 0, letterSpacing: '-0.015em' }}>
          {title}
        </h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function ProvidersPane({ t }) {
  return (
    <>
      <PaneHeader
        title={t('服务商与模型', 'Providers & Models')}
        subtitle={t('管理 LLM 后端及其默认模型。API key 经 electron safeStorage 加密。', 'Manage LLM backends and per-provider default models. API keys are encrypted via electron safeStorage.')}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn"><Icon name="rotate" size={12} /><span>{t('连接诊断', 'Run diagnostics')}</span></button>
            <button className="btn primary"><Icon name="plus" size={12} /><span>{t('添加服务商', 'Add provider')}</span></button>
          </div>
        }
      />

      {/* Defaults summary */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 18,
        padding: '14px 16px', marginBottom: 20,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, fontSize: 13,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginBottom: 4 }}>
            {t('全局默认模型', 'Global default model')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 13.5, fontWeight: 500 }}>claude-sonnet-4.6</span>
            <span className="t-faint">·</span>
            <span style={{ color: 'var(--text-muted)' }}>Anthropic</span>
          </div>
        </div>
        <div style={{ width: 1, height: 28, background: 'var(--border)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginBottom: 4 }}>
            {t('当前工作区', 'This workspace')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 13.5, fontWeight: 500 }}>gpt-5.1</span>
            <span className="t-faint">·</span>
            <span style={{ color: 'var(--text-muted)' }}>OpenAI</span>
          </div>
        </div>
        <div style={{ width: 1, height: 28, background: 'var(--border)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginBottom: 4 }}>
            {t('推理预算', 'Reasoning budget')}
          </div>
          <div style={{ display: 'flex', gap: 4, padding: 2, background: 'var(--surface-3)', borderRadius: 6, width: 'fit-content' }}>
            {['low', 'medium', 'high'].map((b) => (
              <span key={b} className="btn sm" style={{
                background: b === 'medium' ? 'var(--surface)' : 'transparent',
                boxShadow: b === 'medium' ? 'var(--shadow-sm)' : 'none',
                height: 22, fontSize: 11.5, padding: '0 9px',
              }}>{b}</span>
            ))}
          </div>
        </div>
      </div>

      <SectionLabel t={t}>{t('已连接', 'Connected')}</SectionLabel>
      <SettingCard>
        {MOCK.providers.filter((p) => p.status === 'ok').map((p, i, arr) => (
          <ProviderExpanded key={p.id} p={p} t={t} divider={i < arr.length - 1} />
        ))}
      </SettingCard>

      <SectionLabel t={t}>{t('其他', 'Others')}</SectionLabel>
      <SettingCard>
        {MOCK.providers.filter((p) => p.status !== 'ok').map((p, i, arr) => (
          <ProviderRow key={p.id} p={p} t={t} divider={i < arr.length - 1} />
        ))}
      </SettingCard>
    </>
  );
}

function ProviderExpanded({ p, t, divider }) {
  // demo: show 2-3 models inline under the row
  const models = ({
    anthropic: [
      { name: 'claude-sonnet-4.6', tag: 'default · context 200k' },
      { name: 'claude-opus-4.2',   tag: 'reasoning · slow · context 200k' },
      { name: 'claude-haiku-4.5',  tag: 'fast · cheap' },
    ],
    openai: [
      { name: 'gpt-5.1',           tag: 'default · 400k ctx' },
      { name: 'gpt-5.1-mini',      tag: 'fast' },
      { name: 'o3-mini',           tag: 'reasoning' },
    ],
    deepseek: [
      { name: 'deepseek-v3.1',     tag: 'default' },
      { name: 'deepseek-reasoner', tag: 'reasoning' },
    ],
  })[p.id] || [{ name: p.name + '/default', tag: '' }];

  return (
    <div style={{ borderBottom: divider ? '1px solid var(--border-soft)' : 'none' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 16px',
      }}>
        <span style={{
          width: 30, height: 30, borderRadius: 8,
          background: p.dot || 'var(--surface-3)', opacity: 0.92, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: p.dot ? '#fff' : 'var(--text-muted)',
          fontSize: 12, fontWeight: 600, fontFamily: 'var(--f-mono)',
        }}>{p.name.slice(0, 1)}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 500 }}>{p.name}</span>
            <span className="dot ok" />
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t('已连接', 'Connected')}</span>
            <span className="t-faint">·</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {p.models} {t('个模型', 'models')}
            </span>
          </div>
          <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--text-faint)' }}>
            <span className="mono">https://api.{p.id === 'anthropic' ? 'anthropic.com' : p.id + '.com'}/v1</span>
          </div>
        </div>
        <button className="btn sm">{t('测试', 'Test')}</button>
        <button className="btn sm">{t('编辑', 'Edit')}</button>
      </div>

      <div style={{
        padding: '0 16px 14px',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {models.map((m, i) => (
          <div key={m.name} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 10px',
            background: 'var(--surface-2)', borderRadius: 6,
          }}>
            {i === 0 && (
              <span style={{
                fontSize: 9.5, color: 'var(--accent)', letterSpacing: '.06em',
                textTransform: 'uppercase', fontWeight: 700,
                padding: '1px 5px', background: 'var(--accent-soft)', borderRadius: 3,
              }}>{t('默认', 'default')}</span>
            )}
            <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{m.name}</span>
            <span style={{ flex: 1, color: 'var(--text-faint)', fontSize: 11.5 }}>{m.tag}</span>
            <Toggle on={true} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProviderRow({ p, t, divider }) {
  const status = p.status;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 16px',
      borderBottom: divider ? '1px solid var(--border-soft)' : 'none',
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: 8,
        background: p.dot ? p.dot : 'var(--surface-3)',
        opacity: p.dot ? 0.9 : 1,
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: p.dot ? '#fff' : 'var(--text-muted)',
        fontSize: 12, fontWeight: 600, fontFamily: 'var(--f-mono)',
      }}>
        {p.name.slice(0, 1)}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 500 }}>{p.name}</span>
          {p.desc && (
            <span style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{p.desc}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 11.5, color: 'var(--text-muted)' }}>
          <span className={'dot ' + (status === 'ok' ? 'ok' : status === 'warn' ? 'warn' : 'idle')} />
          <span>{status === 'ok' ? t('已连接', 'Connected') : status === 'warn' ? p.warn : t('未配置', 'Not configured')}</span>
          <span className="t-faint">·</span>
          <span className="mono">{p.models} {t('个模型', 'models')}</span>
        </div>
      </div>
      <button className="btn sm">{t('测试', 'Test')}</button>
      <button className="btn sm">{t('编辑', 'Edit')}</button>
    </div>
  );
}

function McpPane({ t }) {
  return (
    <>
      <PaneHeader
        title={t('MCP 接入', 'MCP servers')}
        subtitle={t('Model Context Protocol — agent 通过这些 server 访问外部数据/工具。', 'Model Context Protocol — agents access external data/tools via these servers.')}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn"><Icon name="layers" size={12} /><span>{t('模板', 'Templates')}</span></button>
            <button className="btn primary"><Icon name="plus" size={12} /><span>{t('添加 server', 'Add server')}</span></button>
          </div>
        }
      />

      {/* Constellation view — novel */}
      <ConstellationView t={t} />

      <div style={{ marginTop: 28 }}>
        <h2 className="h-display" style={{ fontSize: 13, fontWeight: 600, margin: '0 0 10px', color: 'var(--text-muted)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
          {t('详细', 'Details')}
        </h2>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          {MOCK.mcp.map((s, i) => (
            <McpRow key={s.id} s={s} t={t} divider={i < MOCK.mcp.length - 1} />
          ))}
        </div>
      </div>
    </>
  );
}

/* The novel MCP "constellation": each connected server is a node with a
   pulse, sized by tool count, with file-style spokes for each tool. */
function ConstellationView({ t }) {
  // positions chosen by hand to look natural
  const nodes = [
    { id: 'fs', x: 130, y: 100, r: 30, tools: 6, status: 'ok', name: 'fs-mcp' },
    { id: 'pg', x: 280, y: 60, r: 24, tools: 4, status: 'ok', name: 'postgres' },
    { id: 'qd', x: 380, y: 130, r: 22, tools: 3, status: 'warn', name: 'qdrant' },
    { id: 'gh', x: 200, y: 180, r: 36, tools: 12, status: 'ok', name: 'github' },
    { id: 'tv', x: 460, y: 50, r: 18, tools: 2, status: 'idle', name: 'tavily' },
  ];
  const center = { x: 320, y: 130 };
  const W = 600, H = 220;

  return (
    <div style={{
      position: 'relative', height: H + 30,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden',
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
           style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {/* very faint grid */}
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0L0 0 0 20" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.05"/>
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" style={{ color: 'var(--text)' }} />

        {/* spokes to agent center */}
        {nodes.map((n) => (
          <line key={n.id}
            x1={n.x} y1={n.y} x2={center.x} y2={center.y}
            stroke={n.status === 'ok' ? 'var(--accent)' : 'var(--border-strong)'}
            strokeOpacity={n.status === 'ok' ? 0.35 : 0.5}
            strokeWidth="1"
            strokeDasharray={n.status === 'warn' ? '3 3' : '0'}
          />
        ))}

        {/* center agent dot */}
        <circle cx={center.x} cy={center.y} r="7" fill="var(--text)" />
        <circle cx={center.x} cy={center.y} r="13" fill="none" stroke="var(--text)" strokeOpacity=".15" />
        <text x={center.x} y={center.y + 28} textAnchor="middle"
              style={{ font: '11px var(--f-mono)', fill: 'var(--text-muted)' }}>
          agent
        </text>

        {/* nodes */}
        {nodes.map((n) => (
          <g key={n.id}>
            {n.status === 'ok' && (
              <circle cx={n.x} cy={n.y} r={n.r + 4} fill="var(--ok)" opacity="0.10">
                <animate attributeName="r" values={`${n.r};${n.r + 10};${n.r}`} dur="2.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.18;0;0.18" dur="2.6s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={n.x} cy={n.y} r={n.r}
              fill="var(--surface)"
              stroke={n.status === 'ok' ? 'var(--ok)' : n.status === 'warn' ? 'var(--warn)' : 'var(--border-strong)'}
              strokeWidth="1.2"
            />
            <text x={n.x} y={n.y - 2} textAnchor="middle"
                  style={{ font: '600 11px var(--f-body, sans-serif)', fill: 'var(--text)' }}>
              {n.tools}
            </text>
            <text x={n.x} y={n.y + 9} textAnchor="middle"
                  style={{ font: '9px var(--f-mono)', fill: 'var(--text-muted)', letterSpacing: '.04em' }}>
              tools
            </text>
            <text x={n.x} y={n.y + n.r + 14} textAnchor="middle"
                  style={{ font: '11px var(--f-mono)', fill: 'var(--text)' }}>
              {n.name}
            </text>
          </g>
        ))}
      </svg>

      <div style={{
        position: 'absolute', top: 12, left: 14, fontSize: 11,
        color: 'var(--text-faint)', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600,
      }}>
        {t('运行中', 'Live')} · 5 servers · 27 tools
      </div>
      <div style={{
        position: 'absolute', top: 12, right: 14, display: 'flex', gap: 14, fontSize: 11,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span className="dot ok" /><span style={{ color: 'var(--text-muted)' }}>{t('已连接 3', 'connected 3')}</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span className="dot warn" /><span style={{ color: 'var(--text-muted)' }}>{t('告警 1', 'warning 1')}</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span className="dot idle" /><span style={{ color: 'var(--text-muted)' }}>{t('未启动 1', 'idle 1')}</span>
        </span>
      </div>
    </div>
  );
}

function McpRow({ s, t, divider }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px',
      borderBottom: divider ? '1px solid var(--border-soft)' : 'none',
    }}>
      <span className={'dot ' + (s.status === 'ok' ? 'ok' : s.status === 'warn' ? 'warn' : 'idle')} style={{ width: 7, height: 7 }} />
      <span style={{ fontWeight: 500, minWidth: 140 }}>{s.name}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', padding: '2px 7px', background: 'var(--surface-3)', borderRadius: 4 }}>
        {s.transport}
      </span>
      <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: 12.5 }}>{s.desc}</span>
      <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{s.tools} tools</span>
      <button className="btn sm ghost"><Icon name="moreV" size={12} /></button>
    </div>
  );
}

function SkillsPane({ t }) {
  return (
    <>
      <PaneHeader
        title={t('技能', 'Skills')}
        subtitle={t('Markdown 模板，agent 通过 / 触发。来源：~/.pi/agent/skills 与当前工作区 .skills/', 'Markdown templates triggered with /. Sources: ~/.pi/agent/skills and .skills/ in workspace')}
        action={<button className="btn"><Icon name="folder" size={12} /><span>{t('打开目录', 'Open folder')}</span></button>}
      />

      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, overflow: 'hidden',
      }}>
        {MOCK.skills.map((s, i) => (
          <div key={s.name} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 16px',
            borderBottom: i < MOCK.skills.length - 1 ? '1px solid var(--border-soft)' : 'none',
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 7,
              background: s.enabled ? 'var(--accent-soft)' : 'var(--surface-3)',
              color: s.enabled ? 'var(--accent)' : 'var(--text-faint)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon name="skill" size={13} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>/{s.name}</span>
                <span style={{
                  fontSize: 10, color: 'var(--text-faint)', letterSpacing: '.06em',
                  textTransform: 'uppercase', fontWeight: 600,
                  padding: '1px 5px', background: 'var(--surface-3)', borderRadius: 3,
                }}>
                  {s.source === 'global' ? t('全局', 'global') : t('工作区', 'workspace')}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{s.desc}</div>
            </div>
            <Toggle on={s.enabled} />
          </div>
        ))}
      </div>
    </>
  );
}

function Toggle({ on }) {
  return (
    <div style={{
      width: 32, height: 18, borderRadius: 999,
      background: on ? 'var(--text)' : 'var(--border-strong)',
      position: 'relative', flexShrink: 0,
      transition: 'background .15s',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.15)',
        transition: 'left .15s',
      }} />
    </div>
  );
}

Object.assign(window, { SettingsView, ProvidersPane, McpPane, SkillsPane, ConstellationView, Toggle });
