import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Plus, Square, X } from "lucide-react";
import type { ApiClient, Provider } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { MentionMenu } from "./MentionMenu.js";
import { ModelPicker, type Reasoning } from "./ModelPicker.js";
import { PermissionChip, type Permission } from "./PermissionChip.js";
import { SlashMenu } from "./SlashMenu.js";

interface Props {
  api: ApiClient;
  workspaceId: string | null;
  providers: readonly Provider[];
  providerId: string;
  model: string;
  onModelChange: (next: { providerId: string; model: string }) => void;
  contextFiles: readonly string[];
  onAddContextFile: (path: string) => void;
  onRemoveContextFile: (path: string) => void;
  sending: boolean;
  onStop?: () => void;
  onSubmit: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  permission?: Permission;
  reasoning?: Reasoning;
  onPermissionChange?: (p: Permission) => void;
  onReasoningChange?: (r: Reasoning) => void;
}

/** ext → glyph + colour swatch (mirrors the design's AttachmentCard kindMap). */
const KIND: Record<string, { glyph: string; bg: string; fg: string }> = {
  json: { glyph: "{ }", bg: "oklch(0.96 0.04 60)", fg: "oklch(0.55 0.16 50)" },
  md: { glyph: "MD", bg: "oklch(0.95 0.04 145)", fg: "oklch(0.50 0.14 145)" },
  ts: { glyph: "TS", bg: "oklch(0.95 0.04 240)", fg: "oklch(0.50 0.14 240)" },
  tsx: { glyph: "TS", bg: "oklch(0.95 0.04 240)", fg: "oklch(0.50 0.14 240)" },
  js: { glyph: "JS", bg: "oklch(0.96 0.04 95)", fg: "oklch(0.52 0.13 95)" },
  py: { glyph: "PY", bg: "oklch(0.95 0.04 240)", fg: "oklch(0.50 0.14 240)" },
  pdf: { glyph: "PDF", bg: "oklch(0.95 0.04 28)", fg: "oklch(0.55 0.16 28)" }
};

function kindFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return {
    ext,
    ...(KIND[ext] ?? {
      glyph: (ext || "TXT").toUpperCase().slice(0, 3),
      bg: "var(--surface-3)",
      fg: "var(--text-muted)"
    })
  };
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

/** The `/` or `@` token immediately before the caret, anywhere in the text. */
interface Trigger {
  kind: "slash" | "mention";
  query: string;
  start: number; // index of the trigger symbol
  end: number; // caret position
}

function detectTrigger(value: string, caret: number): Trigger | null {
  const before = value.slice(0, caret);
  const m = /(^|\s)([/@])(\S*)$/.exec(before);
  if (!m) return null;
  const symbol = m[2];
  const query = m[3] ?? "";
  return {
    kind: symbol === "/" ? "slash" : "mention",
    query,
    start: caret - query.length - 1,
    end: caret
  };
}

export function Composer(props: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [mentionSuggestions, setMentionSuggestions] = useState<{ path: string }[]>([]);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function autoSize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }

  function closeMenus() {
    setTrigger(null);
    setSlashQuery(null);
    setMentionSuggestions([]);
  }

  async function handleChange(value: string, caret: number) {
    setDraft(value);
    requestAnimationFrame(autoSize);
    const next = detectTrigger(value, caret);
    setTrigger(next);
    if (!next) {
      setSlashQuery(null);
      setMentionSuggestions([]);
      return;
    }
    if (next.kind === "slash") {
      setSlashQuery(next.query);
      setMentionSuggestions([]);
    } else {
      setSlashQuery(null);
      if (props.workspaceId) {
        const items = await props.api.searchFiles(props.workspaceId, next.query);
        setMentionSuggestions(Array.isArray(items) ? items : []);
      }
    }
  }

  function submit() {
    if (props.sending) return;
    const text = draft.trim();
    if (!text) return;
    props.onSubmit(text);
    setDraft("");
    closeMenus();
    requestAnimationFrame(autoSize);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  /** Replace the active trigger token (e.g. `@que`) with `replacement`. */
  function replaceTriggerToken(replacement: string) {
    if (!trigger) return;
    setDraft((d) => d.slice(0, trigger.start) + replacement + d.slice(trigger.end));
    requestAnimationFrame(autoSize);
    textareaRef.current?.focus();
  }

  function pickSlash(name: string) {
    // App slash-commands have no inline text payload yet → just dismiss the token.
    replaceTriggerToken("");
    void name;
    closeMenus();
  }

  function pickMention(path: string) {
    props.onAddContextFile(path);
    // Remove the "@query" token when the menu was opened by typing; the "+"
    // picker has no trigger, so nothing to strip.
    if (trigger) replaceTriggerToken("");
    else textareaRef.current?.focus();
    setTrigger(null);
    setMentionSuggestions([]);
  }

  async function openAttachPicker() {
    if (!props.workspaceId) return;
    const items = await props.api.searchFiles(props.workspaceId, "");
    setTrigger(null);
    setSlashQuery(null);
    setMentionSuggestions(Array.isArray(items) ? items : []);
  }

  return (
    <div className="relative w-full">
      {slashQuery !== null && (
        <SlashMenu query={slashQuery} onSelect={pickSlash} onClose={() => setSlashQuery(null)} />
      )}
      {mentionSuggestions.length > 0 && (
        <MentionMenu
          suggestions={mentionSuggestions}
          onSelect={pickMention}
          onClose={() => setMentionSuggestions([])}
        />
      )}
      <div className="rounded-[14px] border border-border bg-surface px-3.5 pt-3 pb-2 shadow-sm">
        {/* attachment cards */}
        {props.contextFiles.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-2">
            {props.contextFiles.map((p) => {
              const k = kindFor(p);
              return (
                <div
                  key={p}
                  className="relative flex min-w-0 max-w-[240px] items-center gap-2.5 rounded-[10px] border border-border bg-surface-2 py-1.5 pl-1.5 pr-3"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-bold tracking-tight"
                    style={{ background: k.bg, color: k.fg }}
                  >
                    {k.glyph}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{basename(p)}</div>
                    <div className="mt-0.5 text-[11px] text-text-muted">
                      {(k.ext || "txt").toUpperCase()}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`${t("composer.remove")} ${p}`}
                    onClick={() => props.onRemoveContextFile(p)}
                    className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/80 text-white shadow-sm active:scale-90"
                  >
                    <X className="h-2.5 w-2.5" strokeWidth={2.2} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <textarea
          ref={textareaRef}
          autoFocus={props.autoFocus}
          aria-label={t("composer.message")}
          value={draft}
          onChange={(e) =>
            void handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }
          onKeyDown={onKey}
          placeholder={props.placeholder}
          rows={1}
          className={cn(
            "w-full resize-none border-0 bg-transparent text-sm leading-relaxed outline-none placeholder:text-text-subtle",
            "min-h-[40px] max-h-[260px]"
          )}
        />
        <div className="mt-2 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-text-muted"
            aria-label={t("composer.addAttachment")}
            disabled={!props.workspaceId}
            onClick={() => void openAttachPicker()}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <PermissionChip
            value={props.permission ?? "full"}
            onChange={props.onPermissionChange ?? (() => {})}
          />
          <span className="flex-1" />
          <ModelPicker
            providers={props.providers}
            providerId={props.providerId}
            model={props.model}
            onChange={props.onModelChange}
            reasoning={props.reasoning ?? "medium"}
            onReasoningChange={props.onReasoningChange ?? (() => {})}
          />
          {props.sending ? (
            <Button
              size="icon"
              className="ml-1 h-7 w-7 rounded-full"
              onClick={props.onStop}
              aria-label={t("composer.stop")}
            >
              <Square className="h-3.5 w-3.5" strokeWidth={2} />
            </Button>
          ) : (
            <Button
              size="icon"
              className="ml-1 h-7 w-7 rounded-full"
              disabled={!draft.trim()}
              onClick={submit}
              aria-label={t("composer.send")}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
