export interface NoteImage {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export const NOTE_IMAGE_MAX_COUNT = 3;
export const NOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const NOTE_IMAGES_MAX_BYTES = 20 * 1024 * 1024;
export const NOTE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
