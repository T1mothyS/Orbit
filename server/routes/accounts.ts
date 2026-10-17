import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { type JwtPayload } from '../auth.js';
import { describeErrorData } from '../runtime/logging.js';
import { v4 as uuidv4 } from 'uuid';
import * as dbModule from '../db.js';
import bcrypt from 'bcryptjs';
import { generateCode, sendVerificationEmail, summarizeEmailSendResult } from '../email-service.js';
import { addLog } from '../log-service.js';
import { getInviteCodeRole } from '../invite-code-service.js';
import * as db from '../db.js';
import { changeAccountPassword, PasswordChangeError } from '../account-security.js';
import { InMemoryRateLimitStore } from '../http-security.js';
import { newPasswordError } from '../../src/utils/password-policy.js';

export function createAccountsRouter({ authenticate, signUserToken, setPageSessionCookie, setPageSessionFromBearer, clearPageSessionCookie }: Pick<ReturnType<typeof createAuth>, 'authenticate' | 'signUserToken' | 'setPageSessionCookie' | 'setPageSessionFromBearer' | 'clearPageSessionCookie'>) {
  const app = Router();
  const passwordAttempts = new InMemoryRateLimitStore();
  const auditPassword = (userId: string, code: string) => {
    try { addLog(code === 'SUCCESS' ? 'info' : 'warn', 'auth', '账号密码更新结果', { event: 'account_password_change', userId, resultCode: code }); }
    catch { /* Audit storage failure must not misreport a committed password change. */ }
  };
  app.post("/api/auth/send-register-code", async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = req.body?.password;
      const invite_code = String(req.body?.invite_code || '');
      if (!email || !password || !invite_code) {
        return res.status(400).json({ error: '请填写邮箱、密码和邀请码' });
      }
      const invalid = newPasswordError(password);
      if (invalid) return res.status(400).json({ error: invalid });
      // 验证邀请码
      const role = getInviteCodeRole(invite_code);
      if (!role) {
        return res.status(400).json({ error: '邀请码无效，请联系管理员获取有效邀请码' });
      }
      // 检查邮箱是否已注册
      const existing = db.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ error: '该邮箱已被注册' });
      }
      // 生成验证码
      const code = generateCode();
      const codeRecord: dbModule.DbEmailCode = {
        id: uuidv4(),
        email,
        code,
        purpose: 'register',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10分钟
        created_at: new Date().toISOString()
      };
      db.createEmailCode(codeRecord);
      // 发送邮件
      const sendResult = await sendVerificationEmail(email, code, 'register');
      addLog('info', 'mail', `注册验证码已发送至 ${email}，权限: ${role}`, {
        event: 'verification_email_sent',
        email,
        purpose: 'register',
        role,
        ...summarizeEmailSendResult(sendResult),
      });
      res.json({ success: true, message: '验证码已发送到您的邮箱' });
    } catch (error: any) {
      addLog('error', 'mail', '发送验证码失败', describeErrorData(error, {
        event: 'verification_email_failed',
      }));
      console.error('[Send Register Code] Error:', error);
      res.status(500).json({ error: '发送验证码失败: ' + (error?.message || '未知错误') });
    }
  });

  // 完成注册
  app.post("/api/auth/register", async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = req.body?.password;
      const code = String(req.body?.code || '').trim();
      const invite_code = String(req.body?.invite_code || '');
      if (!email || !password || !code) {
        return res.status(400).json({ error: '请填写完整信息' });
      }
      const invalid = newPasswordError(password);
      if (invalid) return res.status(400).json({ error: invalid });
      // 验证邀请码
      const role = getInviteCodeRole(invite_code);
      if (!role) {
        return res.status(400).json({ error: '邀请码无效' });
      }
      // 验证邮箱验证码
      const validCode = db.verifyEmailCode(email, code, 'register');
      if (!validCode) {
        return res.status(400).json({ error: '验证码无效或已过期，请重新获取' });
      }
      // 哈希密码
      const password_hash = await bcrypt.hash(password, 10);
      const userId = uuidv4();
      const now = new Date().toISOString();
      const user = db.createUser({
        id: userId,
        email,
        password_hash,
        role,
        disabled: 0,
        auth_version: 0,
        created_at: now,
        updated_at: now
      });
      // 删除已用验证码
      db.deleteEmailCode(email, 'register');
      // 创建该用户的提醒设置（默认禁用）
      db.upsertReminder({
        id: uuidv4(),
        user_id: userId,
        enabled: 0,
        hour: 8,
        minute: 0,
        reminder_email: email,
        created_at: now,
        updated_at: now
      });
      // 生成 JWT
      const token = signUserToken(user);
      addLog('info', 'auth', `新用户注册: ${email}，权限: ${role}`, { userId, role });
      setPageSessionCookie(res, token);
      res.json({ success: true, token, user: { id: user.id, email: user.email, role: user.role } });
    } catch (error: any) {
      addLog('error', 'auth', `注册失败: ${error.message}`);
      console.error('[Register] Error:', error);
      res.status(500).json({ error: '注册失败: ' + (error?.message || '未知错误') });
    }
  });

  // 登录
  app.post("/api/auth/login", async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!email || !password) {
        return res.status(400).json({ error: '请填写邮箱和密码' });
      }
      const user = db.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: '邮箱或密码错误' });
      }
      if (user.disabled) {
        return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
      }
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: '邮箱或密码错误' });
      }
      // A password/role change can occur while bcrypt yields. Never turn an old
      // password comparison into a token for a newer credential version.
      const current = db.getUserByEmail(email);
      if (!current || current.disabled || current.password_hash !== user.password_hash || (current.auth_version ?? 0) !== (user.auth_version ?? 0))
        return res.status(401).json({ error: '账号状态已变化，请重新登录' });
      const token = signUserToken(current);

      // 更新最后登录时间
      db.updateUserLastLogin(user.id);

      addLog('info', 'auth', `用户登录: ${email}`, { userId: user.id, role: user.role });
      setPageSessionCookie(res, token);
      res.json({ success: true, token, user: { id: user.id, email: user.email, role: user.role } });
    } catch (error: any) {
      addLog('error', 'auth', `登录失败: ${error.message}`);
      console.error('[Login] Error:', error);
      res.status(500).json({ error: '登录失败: ' + (error?.message || '未知错误') });
    }
  });

  // 获取当前用户信息
  app.get("/api/auth/me", authenticate, (req, res) => {
    const payload = (req as any).user as JwtPayload;
    const user = db.getUserById(payload.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    setPageSessionFromBearer(req, res);
    res.json({ user });
  });

  // 登出接口不要求当前 Bearer 有效，以便失效账号也能清理网页 Cookie。
  app.post("/api/auth/logout", (_req, res) => {
    clearPageSessionCookie(res);
    res.json({ success: true });
  });

  app.post('/api/auth/change-password', authenticate, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const payload = (req as any).user as JwtPayload;
    const attempt = passwordAttempts.consume(`password:${payload.userId}`, 5, 15 * 60_000);
    if (!attempt.allowed) {
      auditPassword(payload.userId, 'PASSWORD_RATE_LIMITED');
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((attempt.resetAt - Date.now()) / 1000))));
      return res.status(429).json({ code: 'PASSWORD_RATE_LIMITED', error: '修改密码尝试过于频繁，请稍后再试。' });
    }
    try {
      await changeAccountPassword(payload.userId, payload.authVersion, req.body?.currentPassword, req.body?.newPassword);
      clearPageSessionCookie(res);
      auditPassword(payload.userId, 'SUCCESS');
      return res.json({ success: true, reauthRequired: true });
    } catch (error) {
      if (error instanceof PasswordChangeError) {
        auditPassword(payload.userId, error.code);
        return res.status(error.status).json({ code: error.code, error: error.message });
      }
      auditPassword(payload.userId, 'PASSWORD_SAVE_FAILED');
      // Never put request bodies, password hashes or disk exception detail into logs/responses.
      return res.status(503).json({ code: 'PASSWORD_SAVE_FAILED', error: '密码未能确认保存，请稍后重新登录后检查，再重试修改。' });
    }
  });

  // 获取所有用户列表（管理员）- 支持分页和搜索
  return app;
}
