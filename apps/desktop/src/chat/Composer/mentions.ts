/**
 * Pull `@path` file references out of composer text. A mention is an `@` that
 * starts the string or follows whitespace, then a run of non-space characters
 * (so `a@b.com` is not a mention). Used to embed `@`-referenced files alongside
 * `+` attachments when a message is sent. Result is de-duplicated, order-preserving.
 */
export function extractMentions(text: string): string[] {
  const re = /(?:^|\s)@(\S+)/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const path = match[1];
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}
