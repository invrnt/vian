/** Telegram sendMessage accepts 4096 characters after entity parsing. Leave room for escapes. */
export const TELEGRAM_TEXT_LIMIT = 4096;
const RAW_CHUNK_LIMIT = 1800;

export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_\*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function escapeCode(text: string): string { return text.replace(/([`\\])/g, '\\$1'); }
function escapeLink(text: string): string { return text.replace(/([)\\])/g, '\\$1'); }

/** Renders the small, portable Markdown subset Vian emits; unsupported markup is escaped text. */
export function renderMarkdownV2(source: string): string {
  const token = /```([^\n`]*)\n([\s\S]*?)```|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let at = 0;
  let rendered = '';
  for (const match of source.matchAll(token)) {
    const index = match.index;
    rendered += escapeMarkdownV2(source.slice(at, index));
    if (match[2] !== undefined) {
      const language = match[1]?.replace(/[^A-Za-z0-9_+-]/g, '') ?? '';
      rendered += `\`\`\`${language}\n${escapeCode(match[2])}\`\`\``;
    } else if (match[3] !== undefined) rendered += `\`${escapeCode(match[3])}\``;
    else if (match[4] !== undefined) rendered += `[${escapeMarkdownV2(match[4])}](${escapeLink(match[5]!)})`;
    else if (match[6] !== undefined) rendered += `*${escapeMarkdownV2(match[6])}*`;
    else if (match[7] !== undefined) rendered += `_${escapeMarkdownV2(match[7])}_`;
    at = index + match[0].length;
  }
  return rendered + escapeMarkdownV2(source.slice(at));
}

/** Split canonical text before rendering, at Unicode scalar and line boundaries. */
export function chunkMarkdown(source: string): Array<{ plain: string; markdown: string }> {
  if (!source) return [];
  const chunks: string[] = [];
  let current = '';
  for (const scalar of source) {
    if (current.length + scalar.length > RAW_CHUNK_LIMIT) {
      const breakAt = Math.max(current.lastIndexOf('\n'), current.lastIndexOf(' '));
      if (breakAt > RAW_CHUNK_LIMIT / 2) {
        chunks.push(current.slice(0, breakAt + 1));
        current = current.slice(breakAt + 1);
      } else { chunks.push(current); current = ''; }
    }
    current += scalar;
  }
  if (current) chunks.push(current);
  let fenced = false;
  let language = '';
  return chunks.map(raw => {
    let plain = fenced ? `\`\`\`${language}\n${raw}` : raw;
    for (const match of raw.matchAll(/```([^\n`]*)\n|```/g)) {
      if (fenced) { fenced = false; language = ''; }
      else { fenced = true; language = match[1]?.replace(/[^A-Za-z0-9_+-]/g, '') ?? ''; }
    }
    if (fenced) plain += '\n```';
    const markdown = renderMarkdownV2(plain);
    // Escape expansion stays below the API limit because raw chunks are <1800 UTF-16 units.
    return { plain, markdown: [...markdown].length <= TELEGRAM_TEXT_LIMIT ? markdown : escapeMarkdownV2(plain) };
  });
}
