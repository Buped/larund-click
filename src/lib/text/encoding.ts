const MOJIBAKE_RE = /[\uFFFD]|(?:Ã|Â|Ä|Å|Ĺ|Ă|â€|â€“|â€”|â€™|â€œ|â€\u009d)/;
const HUNGARIAN_RE = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g;

export function looksMojibake(text: string): boolean {
  return MOJIBAKE_RE.test(text);
}

export function repairMojibake(text: string): string {
  if (!text || !looksMojibake(text)) return text;
  if (text.includes('\uFFFD')) return text;
  const latin1 = decodeLatin1AsUtf8(text);
  const cp1250 = decodeWindows1250AsUtf8(text);
  const best = [text, latin1, cp1250].sort((a, b) => scoreText(b) - scoreText(a))[0];
  return scoreText(best) > scoreText(text) ? best : text;
}

export function cleanWebText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return repairMojibake(trimmed);
}

function decodeLatin1AsUtf8(text: string): string {
  try {
    const bytes = Uint8Array.from(Array.from(text, (ch) => ch.charCodeAt(0) & 0xff));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return text;
  }
}

function decodeWindows1250AsUtf8(text: string): string {
  try {
    const bytes = Uint8Array.from(Array.from(text, (ch) => ch.charCodeAt(0) & 0xff));
    return new TextDecoder('windows-1250', { fatal: false }).decode(bytes);
  } catch {
    return text;
  }
}

function scoreText(text: string): number {
  const replacement = (text.match(/\uFFFD/g) ?? []).length;
  const mojibake = (text.match(MOJIBAKE_RE) ?? []).length;
  const hu = (text.match(HUNGARIAN_RE) ?? []).length;
  const asciiWords = (text.match(/[a-z]{3,}/gi) ?? []).length;
  return hu * 4 + asciiWords - replacement * 16 - mojibake * 8;
}
