export interface NoteImage {
  id: string;
  name: string;
  mime: string;
  size: number;
  textOffset?: number;
}

export interface NoteImagePlacement {
  id: string;
  textOffset?: number;
}

export function noteImageParts(content: string, images: readonly NoteImage[]) {
  const inline = images.filter((image): image is NoteImage & { textOffset: number } => image.textOffset !== undefined)
    .sort((a, b) => a.textOffset - b.textOffset);
  const trailing = images.filter(image => image.textOffset === undefined);
  let start = 0;
  const parts: Array<string | NoteImage> = [];
  for (const image of inline) {
    if (image.textOffset > start) parts.push(content.slice(start, image.textOffset));
    parts.push(image);
    start = image.textOffset;
  }
  if (start < content.length) parts.push(content.slice(start));
  return { parts, trailing };
}
export const NOTE_IMAGE_MAX_COUNT = 3;
export const NOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const NOTE_IMAGES_MAX_BYTES = 20 * 1024 * 1024;
export const NOTE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
