import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestError } from '../src/utils/request-error.js';

test('a write timeout preserves uncertainty; read timeout does not imply a write', () => {
  const timeout = new Error('signal timed out'); timeout.name = 'TimeoutError';
  assert.match(requestError(timeout, '失败', true), /结果尚未确认/);
  assert.match(requestError(timeout, '失败'), /读取超时/);
  assert.equal(requestError(new Error('事项已经更新，请重新读取'), '失败', true), '事项已经更新，请重新读取');
  assert.equal(requestError(null, '保存失败', true), '保存失败');
});
