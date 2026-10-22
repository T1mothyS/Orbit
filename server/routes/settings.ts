import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { type JwtPayload } from '../auth.js';

import * as dbModule from '../db.js';
import jwt from 'jsonwebtoken';
import { normaliseCodeBuddyBaseUrl } from '../codebuddy-env.js';
import { addLog } from '../log-service.js';
import * as db from '../db.js';
import { defaultModel, modelService, getAvailableModels, resolveCodeBuddyCredentialInfo, resolveCodeBuddyCredential, getMissingCodeBuddyCredentialMessage } from '../ai-credentials.js';
import { workBuddyProvider } from '../ai-provider-workbuddy.js';
import { aiErrorInfo } from '../ai-execution.js';

export function createSettingsRouter({ authenticate, JWT_SECRET }: Pick<ReturnType<typeof createAuth>, 'authenticate'> & { JWT_SECRET: string }) {
  const app = Router();
  app.get("/api/schedule-model", authenticate, (req, res) => {
    const userId = ((req as any).user as JwtPayload).userId;
    res.json({ model: db.getUserPreferredModel(userId, defaultModel) });
  });
  app.post("/api/schedule-model", authenticate, (req, res) => {
    const userId = ((req as any).user as JwtPayload).userId;
    const model = String(req.body?.model || '').trim();
    if (!model || model.length > 100) return res.status(400).json({ error: '模型名称无效' });
    if (!db.updateUserPreferredModel(userId, model)) return res.status(404).json({ error: '用户不存在' });
    res.json({ success: true, model });
  });

  interface LoginStatusResponse {
    isLoggedIn: boolean;
    hasApiKey?: boolean;
    error?: string;
    apiKey?: string; // 脱敏后的 API Key
    usingSharedApi?: boolean;
  }

  // 【修复】检查 API Key 状态
  // 【修复数据隔离】检查登录状态 - 获取当前用户的 API Key
  app.get("/api/check-login", authenticate, async (req, res) => {
    const response: LoginStatusResponse = {
      isLoggedIn: false,
    };

    // 从 JWT 获取当前用户 ID
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as JwtPayload;
        const resolvedCredential = resolveCodeBuddyCredentialInfo(payload.userId);
        const userKey = resolvedCredential?.credential;

        if (userKey?.api_key) {
          response.isLoggedIn = true;
          response.hasApiKey = true;
          if (resolvedCredential?.source === 'admin-shared') {
            // 共享凭据只在服务端使用，普通用户前端不能看到任何 Key 片段。
            response.usingSharedApi = true;
          } else {
            // 个人 Key 仍按原有方式脱敏显示。
            response.apiKey = userKey.api_key.slice(0, 8) + '****' + userKey.api_key.slice(-4);
          }
        } else {
          response.hasApiKey = false;
          response.error = getMissingCodeBuddyCredentialMessage(payload.userId);
        }
      } catch {
        response.error = '登录状态验证失败';
      }
    } else {
      response.error = '未登录';
    }

    res.json(response);
  });

  // 获取可用模型列表
  // 【修复数据隔离】获取模型列表 - 需要用户认证
  app.get("/api/models", authenticate, async (req, res) => {
    try {
      // authenticate 已完成 JWT 校验，直接读取当前用户的凭据，避免重复解析和生产日志泄露账号信息。
      const currentUser = (req as any).user as JwtPayload;
      const userCredential = resolveCodeBuddyCredential(currentUser.userId);

      if (!userCredential) {
        return res.status(401).json({
          error: getMissingCodeBuddyCredentialMessage(currentUser.userId),
        });
      }

      const models = await getAvailableModels(
        currentUser.userId,
        userCredential,
        req.query.refresh === '1',
      );

      res.json({
        models: models || [],
        defaultModel
      });
    } catch (error: any) {
      console.error("[Models] Error:", error);
      res.json({
        models: [],
        defaultModel,
        error: error?.message || String(error)
      });
    }
  });

  // ============= AI 日程对话历史 =============

  app.post("/api/verify-api-key", authenticate, async (req, res) => {
    try {
      // 【修复数据隔离】从数据库获取当前用户的 API Key
      let userCredential: dbModule.DbUserApiKey | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as JwtPayload;
          userCredential = resolveCodeBuddyCredential(payload.userId);
        } catch {}
      }

      if (!userCredential) {
        const currentUser = (req as any).user as JwtPayload;
        return res.status(401).json({
          valid: false,
          error: getMissingCodeBuddyCredentialMessage(currentUser.userId),
          code: 'NO_KEY'
        });
      }

      if (/[^\x21-\x7e]/.test(userCredential.api_key)) return res.status(400).json({valid:false,authenticationVerified:false,code:'INVALID_KEY_FORMAT',error:'当前保存的 API Key 含中文、空白或控制字符，无法构造认证请求头。请重新复制原始 Key。'});
      const currentUser = (req as any).user as JwtPayload;
      const model=db.getUserPreferredModel(currentUser.userId,defaultModel);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
      const closed=()=>controller.abort();res.once('close',closed);
      try{
        const answer=await workBuddyProvider.generate({userId:currentUser.userId,model,instructions:'你正在执行连接测试。仅回复 OK，不调用工具，不执行操作。',input:[{type:'text',text:'请只回复 OK。'}],tools:[],responseMode:'text',controller});
        controller.signal.throwIfAborted();if(!answer.trim())throw new Error('模型响应为空');
        res.json({valid:true,verification:'generation',authenticationVerified:true,model});
      }finally{clearTimeout(timer);res.removeListener('close',closed);}
    } catch (error: any) {
      const info=aiErrorInfo(error);addLog('warn','ai','WorkBuddy 连接测试未通过',{userId:((req as any).user as JwtPayload).userId,code:info.code,stage:info.stage});
      return res.status(info.code==='AUTH'?401:info.code==='NETWORK'?503:502).json({valid:false,authenticationVerified:false,error:info.message,code:info.code});
    }
  });

  // ============= 用户 API Key 管理 =============

  // 获取当前用户的 API Key
  app.get("/api/user-api-key", authenticate, (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const payload = (req as any).user as JwtPayload;
      const userApiKey = db.getUserApiKey(payload.userId);

      if (userApiKey) {
        res.json({
          hasKey: true,
          maskedApiKey: userApiKey.api_key.slice(0, 8) + '****' + userApiKey.api_key.slice(-4),
          baseUrl: userApiKey.base_url || ''
        });
      } else {
        res.json({
          hasKey: false,
          apiKey: '',
          baseUrl: ''
        });
      }
    } catch (error: any) {
      console.error("[UserApiKey] Error:", error);
      res.status(500).json({ error: '获取 API Key 失败' });
    }
  });

  // 保存/更新用户的 API Key
  app.post("/api/user-api-key", authenticate, (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const payload = (req as any).user as JwtPayload;
      const { apiKey, baseUrl } = req.body;

      if (!apiKey || !String(apiKey).trim()) {
        return res.status(400).json({ error: 'API Key 不能为空' });
      }
      const normalizedApiKey = String(apiKey).trim();
      if (/[^\x21-\x7e]/.test(normalizedApiKey)) return res.status(400).json({error:'API Key 不能包含中文、空白或控制字符，请复制原始 Key'});
      if (normalizedApiKey.length > 4_096) return res.status(400).json({ error: 'API Key 过长' });
      const normalizedBaseUrl = normaliseCodeBuddyBaseUrl(baseUrl);

      const userApiKey: dbModule.DbUserApiKey = {
        id: `uak_${Date.now()}`,
        user_id: payload.userId,
        api_key: normalizedApiKey,
        base_url: normalizedBaseUrl,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      db.upsertUserApiKey(userApiKey);

      modelService.invalidate(payload.userId);

      addLog('info', 'system', '用户更新了 API Key', { userId: payload.userId });
      res.json({ success: true, message: 'API Key 保存成功' });
    } catch (error: any) {
      console.error("[UserApiKey] Error:", error);
      const message = error?.message || '保存 API Key 失败';
      res.status(String(message).startsWith('CodeBuddy Base URL') ? 400 : 500).json({ error: message });
    }
  });
  return app;
}
