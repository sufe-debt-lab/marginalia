import { readDocument } from "../files/document-reader.js";
import { listWorkspaceFiles, searchWorkspaceFiles } from "../files/file-tree.js";

export function createDocumentTools(rootDir: string) {
  return {
    list_files: async () => listWorkspaceFiles(rootDir),
    read_document: async ({ path }: { path: string }) => readDocument(rootDir, path),
    search_files: async ({ q }: { q: string }) => searchWorkspaceFiles(rootDir, q)
  };
}
