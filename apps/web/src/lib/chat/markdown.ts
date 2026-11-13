// A safe Markdown subset for agent messages (streamed replies are `type: markdown`). Pure parser to a
// small tree; the component renders it with React elements, never HTML strings, so nothing in a
// message can inject markup. Supported: paragraphs and line breaks, # headings (h1-h3 shown as bold
// lines), - / * / 1. lists, **bold**, *italic* / _italic_, `code`, and http(s) links. Everything else
// is plain text. Unclosed markers (common mid-stream) stay as text until they close.

export type Inline =
  { t: 'text'; v: string } | { t: 'strong'; c: Inline[] } | { t: 'em'; c: Inline[] } | { t: 'code'; v: string } | { t: 'link'; href: string; v: string };
export type Block = { t: 'p'; lines: Inline[][] } | { t: 'h'; c: Inline[] } | { t: 'ul'; items: Inline[][] } | { t: 'ol'; items: Inline[][] };

const URL_RE = /https?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/y;

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (rest.startsWith('`')) {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (depth < 3 && rest.startsWith('**')) {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    const ch = src[i]!;
    if (depth < 3 && (ch === '*' || ch === '_') && src[i + 1] !== ch && src[i + 1] !== ' ' && src[i + 1] !== undefined) {
      // _ only at a word start, so snake_case words stay intact.
      const wordStart = i === 0 || /[\s(["'“]/.test(src[i - 1]!);
      const end = src.indexOf(ch, i + 1);
      if (end > i + 1 && src[end - 1] !== ' ' && (ch === '*' || (wordStart && !/[A-Za-z0-9]/.test(src[end + 1] ?? '')))) {
        flush();
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }
    if (ch === 'h') {
      URL_RE.lastIndex = i;
      const m = URL_RE.exec(src);
      if (m) {
        flush();
        out.push({ t: 'link', href: m[0], v: m[0] });
        i += m[0].length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: Inline[][] = [];
  let list: { t: 'ul' | 'ol'; items: Inline[][] } | null = null;
  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', lines: para });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      endPara();
      endList();
      continue;
    }
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      endPara();
      endList();
      blocks.push({ t: 'h', c: parseInline(h[1]!) });
      continue;
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      endPara();
      const kind = ul ? 'ul' : 'ol';
      if (!list || list.t !== kind) {
        endList();
        list = { t: kind, items: [] };
      }
      list.items.push(parseInline((ul ?? ol)![1]!));
      continue;
    }
    endList();
    para.push(parseInline(line));
  }
  endPara();
  endList();
  return blocks;
}
