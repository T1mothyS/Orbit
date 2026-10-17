/** New credentials only. Existing login passwords keep their historical compatibility. */
export function newPasswordError(value: unknown): string | null {
  return typeof value !== 'string' || value.length < 8 || new TextEncoder().encode(value).length > 72
    ? '密码至少需要 8 位，且不能超过 72 个 UTF-8 字节。' : null;
}
