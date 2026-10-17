import bcrypt from 'bcryptjs';
import { getUserCredentials, replaceUserPassword } from './database/queries/accounts.js';
import { assertPersistenceReady, withPersistenceTransaction } from './persistence.js';
import { newPasswordError } from '../src/utils/password-policy.js';

export class PasswordChangeError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

export async function changeAccountPassword(userId: string, authVersion: number, currentPassword: unknown, newPassword: unknown): Promise<void> {
  if (typeof currentPassword !== 'string' || !currentPassword)
    throw new PasswordChangeError('CURRENT_PASSWORD_REQUIRED', '请输入当前密码。');
  // bcrypt only uses the first 72 UTF-8 bytes. Reject truncation for new passwords,
  // while still accepting historical long current passwords for verification.
  const invalid = newPasswordError(newPassword);
  if (invalid) throw new PasswordChangeError('NEW_PASSWORD_INVALID', invalid);
  const user = getUserCredentials(userId);
  if (!user || user.disabled || (user.auth_version ?? 0) !== authVersion)
    throw new PasswordChangeError('ACCOUNT_CHANGED', '账号状态已变化，请重新登录后重试。', 409);
  if (!await bcrypt.compare(currentPassword, user.password_hash))
    throw new PasswordChangeError('CURRENT_PASSWORD_INVALID', '当前密码不正确，请重新输入。');
  if (await bcrypt.compare(newPassword as string, user.password_hash))
    throw new PasswordChangeError('PASSWORD_UNCHANGED', '新密码需要与当前密码不同。');
  const hash = await bcrypt.hash(newPassword as string, 10);
  // No await inside the transaction. The CAS protects every async verification gap.
  // A failed disk write rolls back or blocks store access until journal recovery.
  withPersistenceTransaction(() => {
    if (!replaceUserPassword(userId, user.password_hash, authVersion, hash))
      throw new PasswordChangeError('ACCOUNT_CHANGED', '账号状态已变化，请重新登录后重试。', 409);
  });
  // The existing protocol may commit and then block access after its final flush.
  // That is an uncertain outcome for the caller, never an acknowledged success.
  assertPersistenceReady();
}
