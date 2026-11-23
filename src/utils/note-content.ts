export const NOTE_CONTENT_MAX_LENGTH = 1_000_000;
export const NOTE_OPTIMIZATION_MAX_LENGTH = 2_000;

export function noteContentTooLong(text: string): boolean {
  if (text.length <= NOTE_CONTENT_MAX_LENGTH) return false;
  let length = 0;
  for (const _ of text) {
    length++;
    if (length > NOTE_CONTENT_MAX_LENGTH) return true;
  }
  return false;
}

// Positions use the same UTF-16 indices as String.slice and the editor.
export function validNoteTextOffset(text: string, offset: unknown): offset is number {
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > text.length) return false;
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}
