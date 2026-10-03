/** A timed-out write has an unknown result; never present it as a confirmed failure. */
export function requestError(error: unknown, fallback: string, write = false): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return write ? '请求超时，结果尚未确认。请先刷新检查状态，再决定是否重试。' : '读取超时，请稍后重试。';
  }
  return error instanceof Error ? error.message : fallback;
}
