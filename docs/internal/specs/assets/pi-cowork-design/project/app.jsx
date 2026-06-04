/* app.jsx — Composition. Builds artboards, wires Tweaks panel. */

const { useEffect, useMemo } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "aesthetic": "mono",
  "font": "serif",
  "accent": "emerald",
  "density": "regular",
  "locale": "zh",
  "leftCollapsed": false,
  "chatState": "streaming"
}/*EDITMODE-END*/;

const ACCENT_OPTIONS = {
  default:   { warm: 'oklch(0.58 0.135 50)',  cool: 'oklch(0.55 0.16 245)', mono: '#19191a' },
  amber:     { warm: 'oklch(0.66 0.15 60)',   cool: 'oklch(0.66 0.15 60)',  mono: 'oklch(0.55 0.16 60)' },
  emerald:   { warm: 'oklch(0.55 0.14 158)',  cool: 'oklch(0.55 0.14 158)', mono: 'oklch(0.50 0.13 158)' },
  violet:    { warm: 'oklch(0.55 0.18 290)',  cool: 'oklch(0.55 0.18 290)', mono: 'oklch(0.50 0.17 290)' },
  ink:       { warm: '#19191a',               cool: '#19191a',              mono: '#19191a' },
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const tx = (zh, en) => (t.locale === 'zh' ? zh : en);

  // Apply CSS vars / classes to the canvas world so artboards inherit
  useEffect(() => {
    const root = document.documentElement;
    root.className = [
      'theme-' + t.aesthetic,
      'font-' + t.font,
      'density-' + t.density,
    ].join(' ');
    // accent override
    const acc = ACCENT_OPTIONS[t.accent]?.[t.aesthetic];
    if (acc) {
      root.style.setProperty('--accent', acc);
      // build a soft tint by mixing with bg
      root.style.setProperty('--accent-soft', `color-mix(in oklab, ${acc} 14%, var(--bg))`);
    } else {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-soft');
    }
  }, [t.aesthetic, t.font, t.accent, t.density]);

  return (
    <>
      <DesignCanvas>
        <DCSection id="first-run" title={tx('首启 · 空状态', 'First run · Empty state')} subtitle={tx('没有 workspace、没有 provider', 'No workspace, no provider yet')}>
          <DCArtboard id="firstrun" label="01 · First run" width={1280} height={800}>
            <Frame view="first-run" t={tx} tweaks={t} />
          </DCArtboard>
        </DCSection>

        <DCSection id="new-thread" title={tx('New thread', 'New thread')} subtitle={tx('空 composer + 最近会话', 'Hero composer + recent threads')}>
          <DCArtboard id="newthread-empty" label="02 · Hero" width={1280} height={800}>
            <Frame view="new-thread" t={tx} tweaks={t} />
          </DCArtboard>
          <DCArtboard id="newthread-typed" label="03 · With draft" width={1280} height={800}>
            <Frame view="new-thread-typed" t={tx} tweaks={t} />
          </DCArtboard>
        </DCSection>

        <DCSection id="chat" title={tx('Chat 与右栏文档面板', 'Chat & document panel')} subtitle={tx('三种文档面板状态 · Composer 状态', 'Three doc-panel states · composer states')}>
          <DCArtboard id="chat-stream" label="04 · Streaming" width={1280} height={800}>
            <Frame view="chat" docMode={null} t={tx} tweaks={t} />
          </DCArtboard>
          <DCArtboard id="chat-model-menu" label="05 · Composer · model menu" width={1280} height={800}>
            <Frame view="chat" docMode={null} t={tx} tweaks={t} chatState="done" showModelMenu />
          </DCArtboard>
          <DCArtboard id="chat-tree" label="06 · Doc panel — tree only" width={1280} height={800}>
            <Frame view="chat" docMode="tree" t={tx} tweaks={t} chatState="done" />
          </DCArtboard>
          <DCArtboard id="chat-split" label="07 · Doc panel — split" width={1280} height={800}>
            <Frame view="chat" docMode="split" t={tx} tweaks={t} chatState="done" />
          </DCArtboard>
          <DCArtboard id="chat-drawer" label="08 · Doc panel — multi-tab" width={1280} height={800}>
            <Frame view="chat" docMode="drawer" t={tx} tweaks={t} chatState="done" />
          </DCArtboard>
        </DCSection>

        <DCSection id="settings" title={tx('Settings', 'Settings')} subtitle={tx('通用 · 服务商 · MCP · Skills', 'General · Providers · MCP · Skills')}>
          <DCArtboard id="settings-general" label="09 · General" width={1280} height={800}>
            <Frame view="settings" settingsTab="general" t={tx} tweaks={t} setLocale={(v) => setTweak('locale', v)} />
          </DCArtboard>
          <DCArtboard id="settings-providers" label="10 · Providers & Models" width={1280} height={800}>
            <Frame view="settings" settingsTab="providers" t={tx} tweaks={t} />
          </DCArtboard>
          <DCArtboard id="settings-mcp" label="11 · MCP" width={1280} height={800}>
            <Frame view="settings" settingsTab="mcp" t={tx} tweaks={t} />
          </DCArtboard>
          <DCArtboard id="settings-skills" label="12 · Skills" width={1280} height={800}>
            <Frame view="settings" settingsTab="skills" t={tx} tweaks={t} />
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel>
        <TweakSection label={tx('视觉方向', 'Aesthetic')} />
        <TweakRadio label={tx('主题', 'Theme')} value={t.aesthetic}
          options={['warm', 'cool', 'mono']}
          onChange={(v) => setTweak('aesthetic', v)} />
        <TweakRadio label={tx('字体', 'Type')} value={t.font}
          options={['sans', 'serif', 'mono']}
          onChange={(v) => setTweak('font', v)} />
        <TweakSelect label={tx('强调色', 'Accent')} value={t.accent}
          options={['default', 'amber', 'emerald', 'violet', 'ink']}
          onChange={(v) => setTweak('accent', v)} />

        <TweakSection label={tx('布局', 'Layout')} />
        <TweakRadio label={tx('密度', 'Density')} value={t.density}
          options={['compact', 'regular', 'comfy']}
          onChange={(v) => setTweak('density', v)} />
        <TweakToggle label={tx('折叠侧栏', 'Collapse sidebar')} value={t.leftCollapsed}
          onChange={(v) => setTweak('leftCollapsed', v)} />

        <TweakSection label={tx('内容', 'Content')} />
        <TweakRadio label={tx('语言', 'Locale')} value={t.locale}
          options={['zh', 'en']}
          onChange={(v) => setTweak('locale', v)} />
        <TweakSelect label={tx('Chat 状态', 'Chat state')} value={t.chatState}
          options={['streaming', 'done', 'error']}
          onChange={(v) => setTweak('chatState', v)} />
      </TweaksPanel>
    </>
  );
}

/* ── Frame — single artboard, full app shell composed for a view ── */
function Frame({ view, docMode, settingsTab, chatState, showModelMenu, t, tweaks, setLocale }) {
  const collapsed = tweaks.leftCollapsed;
  const cs = chatState || tweaks.chatState;

  let title = 'New chat';
  let main = null;
  let hasRight = false;
  let active = 'new-thread';
  let showInfo = false;

  if (view === 'first-run') {
    title = t('欢迎', 'Welcome');
    main = <FirstRunView t={t} />;
    active = 'new-thread';
  } else if (view === 'new-thread') {
    title = t('新对话', 'New chat');
    main = <NewThreadView workspace="marginalia" branch="main" locale={tweaks.locale} t={t} />;
  } else if (view === 'new-thread-typed') {
    title = t('新对话', 'New chat');
    main = <NewThreadView workspace="marginalia" branch="main" hasInput locale={tweaks.locale} t={t} />;
  } else if (view === 'chat') {
    title = t('把 PR 排期重写为按周分块', 'Rewrite PR schedule by week');
    showInfo = true;
    active = 'session';
    main = <ChatView state={cs} showModelMenu={showModelMenu} locale={tweaks.locale} t={t} />;
    hasRight = docMode != null;
  } else if (view === 'settings') {
    title = t('设置', 'Settings');
    active = 'settings';
    main = <SettingsView tab={settingsTab} t={t} locale={tweaks.locale} setLocale={setLocale} />;
  }

  return (
    <div className="pi-frame">
      <Topbar
        title={title}
        showRight={view === 'chat'}
        leftCollapsed={collapsed}
        rightCollapsed={!hasRight}
        hasInfo={showInfo}
      />
      <div className="body">
        <Sidebar active={active} collapsed={collapsed} locale={tweaks.locale} lang={t} />
        <main className="main">{main}</main>
        {hasRight && <DocPanel mode={docMode} t={t} />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
