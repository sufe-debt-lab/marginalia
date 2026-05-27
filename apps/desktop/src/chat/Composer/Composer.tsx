import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Plus, X } from "lucide-react";
import type { ApiClient, Provider } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/lib/cn.js";
import { MentionMenu } from "./MentionMenu.js";
import { ModelPicker } from "./ModelPicker.js";
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
  onSubmit: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}

export function Composer(props: Props) {
  const [draft, setDraft] = useState("");
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [mentionSuggestions, setMentionSuggestions] = useState<{ path: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function autoSize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }

  async function handleChange(value: string) {
    setDraft(value);
    requestAnimationFrame(autoSize);
    const slashMatch = /^\/(\w*)$/.exec(value);
    setSlashQuery(slashMatch ? slashMatch[1] ?? "" : null);
    if (value.endsWith("@") && props.workspaceId) {
      const items = await props.api.searchFiles(props.workspaceId, "");
      setMentionSuggestions(Array.isArray(items) ? items : []);
    } else if (!value.includes("@")) {
      setMentionSuggestions([]);
    }
  }

  function submit() {
    const text = draft.trim();
    if (!text) return;
    props.onSubmit(text);
    setDraft("");
    setSlashQuery(null);
    setMentionSuggestions([]);
    requestAnimationFrame(autoSize);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  function pickSlash(_name: string) {
    setDraft("");
    setSlashQuery(null);
  }

  function pickMention(path: string) {
    props.onAddContextFile(path);
    setDraft(draft.replace(/@$/, ""));
    setMentionSuggestions([]);
    requestAnimationFrame(autoSize);
    textareaRef.current?.focus();
  }

  return (
    <div className="relative w-full">
      {slashQuery !== null && (
        <SlashMenu
          query={slashQuery}
          onSelect={pickSlash}
          onClose={() => setSlashQuery(null)}
        />
      )}
      {mentionSuggestions.length > 0 && (
        <MentionMenu
          suggestions={mentionSuggestions}
          onSelect={pickMention}
          onClose={() => setMentionSuggestions([])}
        />
      )}
      <div className="rounded-2xl border border-border bg-background px-3 pt-3 pb-2 shadow-sm">
        <textarea
          ref={textareaRef}
          autoFocus={props.autoFocus}
          aria-label="Message"
          value={draft}
          onChange={(e) => void handleChange(e.target.value)}
          onKeyDown={onKey}
          placeholder={props.placeholder}
          rows={1}
          className={cn(
            "w-full resize-none border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
            "min-h-[40px] max-h-[260px]"
          )}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {props.contextFiles.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
            >
              <span className="max-w-[200px] truncate">{p}</span>
              <button
                type="button"
                aria-label={`Remove ${p}`}
                onClick={() => props.onRemoveContextFile(p)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Add attachment">
              <Plus className="h-4 w-4" />
            </Button>
            <ModelPicker
              providers={props.providers}
              providerId={props.providerId}
              model={props.model}
              onChange={props.onModelChange}
            />
          </div>
          <Button
            size="icon"
            className="h-7 w-7 rounded-full"
            disabled={props.sending || !draft.trim()}
            onClick={submit}
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
