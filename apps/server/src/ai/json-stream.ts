// Streams the value of one top-level string field out of a JSON object while the JSON is still
// arriving in arbitrary chunks (structured outputs stream as text deltas). Pure and incremental:
// feed it chunks, it calls `emit` with decoded text of that field as soon as it is known.
// Used for Pixel's intro line, which comes first in the plan schema and is shown in chat live.

export function streamJsonStringField(field: string, emit: (text: string) => void): (chunk: string) => void {
  let depth = 0;
  let inString = false;
  let escape = false;
  let unicode: string | null = null;
  /** The string being read (keys only; values of other fields are skipped). */
  let current = '';
  let lastKey: string | null = null;
  /** After a key at depth 1, waiting for ':' then the value. */
  let expectValue = false;
  let capturing = false;
  let finished = false;
  let isKey = false;

  const out = (s: string) => {
    if (capturing && s) emit(s);
  };

  return chunk => {
    if (finished) return;
    let pending = '';
    for (const ch of chunk) {
      if (inString) {
        if (unicode !== null) {
          unicode += ch;
          if (unicode.length === 4) {
            const decoded = String.fromCharCode(parseInt(unicode, 16));
            if (capturing) pending += decoded;
            else if (isKey) current += decoded;
            unicode = null;
          }
          continue;
        }
        if (escape) {
          escape = false;
          if (ch === 'u') {
            unicode = '';
            continue;
          }
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
          const decoded = map[ch] ?? ch;
          if (capturing) pending += decoded;
          else if (isKey) current += decoded;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
          if (capturing) {
            out(pending);
            pending = '';
            capturing = false;
            finished = true;
            return;
          }
          if (isKey) {
            lastKey = current;
            expectValue = true;
          }
          isKey = false;
          continue;
        }
        if (capturing) pending += ch;
        else if (isKey) current += ch;
        continue;
      }
      // outside strings
      if (ch === '"') {
        inString = true;
        current = '';
        if (depth === 1 && expectValue && lastKey === field) {
          capturing = true;
          expectValue = false;
        } else {
          // A string at depth 1 that is not a value we wait for is a key.
          isKey = depth === 1 && !expectValue;
          if (expectValue) expectValue = false;
        }
        continue;
      }
      if (ch === '{' || ch === '[') {
        depth++;
        expectValue = false;
      } else if (ch === '}' || ch === ']') depth--;
      else if (ch === ',') expectValue = false;
      else if (ch === ':') {
        // value follows; expectValue stays set from the key
      } else if (!/\s/.test(ch)) expectValue = false; // number, true, false, null
    }
    out(pending);
  };
}
