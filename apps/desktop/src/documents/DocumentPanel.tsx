import { useEffect, useMemo, useState } from "react";
import { ApiClient, type DocumentContent, type FileEntry } from "../api/client.js";

export function DocumentPanel({
  serverUrl,
  workspaceId,
  onAttach
}: {
  serverUrl: string;
  workspaceId: string;
  onAttach(path: string): void;
}) {
  const api = useMemo(() => new ApiClient(serverUrl), [serverUrl]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [document, setDocument] = useState<DocumentContent | null>(null);

  useEffect(() => {
    void api.listFiles(workspaceId).then((items) => setFiles(Array.isArray(items) ? items : []));
  }, [api, workspaceId]);

  async function openFile(path: string) {
    setDocument(await api.readDocument(workspaceId, path));
  }

  return (
    <aside>
      {files.map((file) => (
        <button key={file.path} onClick={() => void openFile(file.path)}>
          {file.name}
        </button>
      ))}
      {document ? (
        <section>
          <pre>{document.text}</pre>
          <button onClick={() => onAttach(document.path)}>Attach to chat</button>
        </section>
      ) : null}
    </aside>
  );
}
