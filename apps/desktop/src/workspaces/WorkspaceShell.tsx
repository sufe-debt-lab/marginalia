import { useEffect, useMemo, useState } from "react";
import { ApiClient, type Message, type Session, type Workspace } from "../api/client.js";
import { ChatView } from "../chat/ChatView.js";
import { DocumentPanel } from "../documents/DocumentPanel.js";

export function WorkspaceShell({ serverUrl }: { serverUrl: string }) {
  const api = useMemo(() => new ApiClient(serverUrl), [serverUrl]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);

  useEffect(() => {
    void api.listWorkspaces().then((items) => {
      setWorkspaces(items);
      setActiveWorkspace(items[0] ?? null);
    });
  }, [api]);

  async function browse() {
    const picked = await window.marginalia?.pickWorkspaceDirectory?.();
    if (picked) setWorkspacePath(picked);
  }

  async function createWorkspace() {
    const workspace = await api.createWorkspace({ name: workspaceName, rootDir: workspacePath });
    setWorkspaces((items) => [...items, workspace]);
    setActiveWorkspace(workspace);
  }

  async function quickChat() {
    try {
      setActiveSession(await api.createQuickChat());
      setNotice("");
    } catch (error) {
      if ((error as Error).message === "workspace required") setNotice("Create a workspace first");
      else throw error;
    }
  }

  async function createNewSession() {
    if (!activeWorkspace) return;
    const session = await api.createSession({ workspaceId: activeWorkspace.id, title: sessionTitle });
    setActiveSession(session);
    setMessages(await api.listMessages(session.id));
  }

  async function sendMessage() {
    if (!activeSession || !message.trim()) return;
    const saved = await api.createMessage(activeSession.id, { role: "user", content: message });
    setMessages((items) => [...items, saved]);
    setMessage("");
  }

  return (
    <div className="workspace-shell">
      <aside>
        <button onClick={quickChat}>Quick chat</button>
        {notice ? <p>{notice}</p> : null}
        <label>
          Workspace name
          <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
        </label>
        <label>
          Workspace path
          <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} />
        </label>
        <button onClick={browse}>Browse</button>
        <button onClick={createWorkspace}>Create workspace</button>
        <ul>
          {workspaces.map((workspace) => (
            <li key={workspace.id}>{workspace.name}</li>
          ))}
        </ul>
      </aside>
      <section>
        <label>
          Session title
          <input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} />
        </label>
        <button onClick={createNewSession}>New session</button>
        <div aria-label="Messages">
          {messages.map((item) => (
            <p key={item.id}>{item.content}</p>
          ))}
        </div>
        <label>
          Saved message
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>
        <button onClick={sendMessage}>Save message</button>
        {activeSession ? <ChatView serverUrl={serverUrl} session={activeSession} attachedFiles={attachedFiles} /> : null}
      </section>
      {activeWorkspace ? (
        <DocumentPanel
          serverUrl={serverUrl}
          workspaceId={activeWorkspace.id}
          onAttach={(path) => setAttachedFiles((items) => (items.includes(path) ? items : [...items, path]))}
        />
      ) : null}
    </div>
  );
}
