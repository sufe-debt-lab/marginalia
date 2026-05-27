import { useEffect, useMemo, useState } from "react";
import { ApiClient, type Message, type Provider, type Session } from "../api/client.js";

const emptyAttachedFiles: string[] = [];

export function ChatView({
  serverUrl,
  session,
  attachedFiles = emptyAttachedFiles
}: {
  serverUrl: string;
  session: Session;
  attachedFiles?: string[];
}) {
  const api = useMemo(() => new ApiClient(serverUrl), [serverUrl]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(session.model ?? "");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [fileSuggestions, setFileSuggestions] = useState<{ path: string }[]>([]);
  const [contextFiles, setContextFiles] = useState<string[]>(attachedFiles);

  useEffect(() => {
    setContextFiles(attachedFiles);
  }, [attachedFiles]);

  useEffect(() => {
    void api.listProviders().then((items) => {
      const list = Array.isArray(items) ? items : [];
      setProviders(list);
      setProviderId((current) => current || list[0]?.id || "");
      setModel((current) => current || list[0]?.defaultModel || "");
    });
    void api.listMessages(session.id).then((items) => setMessages(Array.isArray(items) ? items : []));
  }, [api, session.id]);

  async function changeModel(value: string) {
    setModel(value);
    await api.updateSession(session.id, { model: value });
  }

  function changeProvider(value: string) {
    setProviderId(value);
    const next = providers.find((p) => p.id === value);
    if (next) void changeModel(next.defaultModel);
  }

  async function send() {
    if (!draft.trim()) return;
    const provider = providers.find((p) => p.id === providerId) ?? providers[0];
    if (!provider) {
      setError("no provider configured");
      return;
    }
    setError("");
    setSending(true);
    const userId = `local-user-${Date.now()}`;
    const assistantId = `local-assistant-${Date.now()}`;
    setMessages((items) => [
      ...items,
      { id: userId, role: "user", content: draft },
      { id: assistantId, role: "assistant", content: "" }
    ]);
    const sentDraft = draft;
    setDraft("");

    try {
      const events = await api.runChat(session.id, {
        providerId: provider.id,
        model: model || provider.defaultModel,
        message: sentDraft,
        contextFiles
      });
      for await (const event of events) {
        if (event.type === "assistant_delta") {
          const delta = (event.payload as { text?: string } | undefined)?.text ?? "";
          if (delta) {
            setMessages((items) =>
              items.map((item) =>
                item.id === assistantId ? { ...item, content: item.content + delta } : item
              )
            );
          }
        }
        if (event.type === "run_failed") {
          const errMsg = (event.payload as { error?: string } | undefined)?.error ?? "run failed";
          throw new Error(errMsg);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function updateDraft(value: string) {
    setDraft(value);
    if (value.endsWith("@")) {
      setFileSuggestions(await api.searchFiles(session.workspaceId, ""));
    }
  }

  function attachFile(path: string) {
    setContextFiles((items) => (items.includes(path) ? items : [...items, path]));
    setFileSuggestions([]);
  }

  return (
    <section>
      <p>This agent can read/write files in the current workspace.</p>
      <label>
        Provider
        <select value={providerId} onChange={(event) => changeProvider(event.target.value)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.defaultModel}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        <input value={model} onChange={(event) => void changeModel(event.target.value)} />
      </label>
      <div aria-label="Messages">
        {messages.map((item) => (
          <p key={item.id} data-role={item.role}>
            {item.content}
          </p>
        ))}
      </div>
      {error ? (
        <p>
          {error} <button onClick={send}>Retry</button>
        </p>
      ) : null}
      {contextFiles.map((path) => (
        <button key={path}>{path}</button>
      ))}
      {fileSuggestions.map((file) => (
        <button key={file.path} onClick={() => attachFile(file.path)}>
          {file.path}
        </button>
      ))}
      <label>
        Message
        <textarea value={draft} onChange={(event) => void updateDraft(event.target.value)} />
      </label>
      <button disabled={sending} onClick={send}>
        Send
      </button>
    </section>
  );
}
