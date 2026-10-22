/** Explicit live-AI sandbox: loopback only, fresh temporary stores, no .env or production credentials. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
const resumeIndex=process.argv.indexOf('--resume');
const resumed=resumeIndex>=0;
const root=resumed?path.resolve(process.argv[resumeIndex+1]||''):fs.mkdtempSync(path.join(os.tmpdir(),'orbit-live-ai-'));
const marker=path.join(root,'.orbit-live-ai-sandbox.json');
if(resumed){
  if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('orbit-live-ai-')||fs.realpathSync(root)!==root)throw new Error('只能恢复本机临时目录中的专用 AI 测试环境');
  const saved=JSON.parse(fs.readFileSync(marker,'utf8'));if(saved.kind!=='orbit-live-ai'||saved.account!=='live-ai-owner')throw new Error('缺少专用测试环境标记');
}else fs.writeFileSync(marker,JSON.stringify({kind:'orbit-live-ai',account:'live-ai-owner'}));
const port=Number(process.argv[2]||4293);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('请使用 1024–65535 的本地测试端口');
Object.assign(process.env,{DATA_DIR:root,NODE_ENV:'test',APP_ENV:'development',JWT_SECRET:randomUUID(),BACKUP_ENCRYPTION_KEY:randomUUID(),
  BACKGROUND_JOBS_ENABLED:'false',ORBIT_PROACTIVE_ENABLED:'false',ANDROID_PUSH_ENABLED:'false',DIGEST_V2_ENABLED:'false',
  CODEBUDDY_API_KEY:'',SMTP_USER:'',SMTP_PASS:'',IMAP_PASS:'',ORBIT_CHATGPT_OWNER_ID:'live-ai-owner'});
// Dynamic imports are mandatory: stores bind DATA_DIR during module initialization.
const api=await import('../server/index.js');await api.initializeServer();
const db=await import('../server/db.js');
const stamp=new Date().toISOString();
if(!resumed)db.createUser({id:'live-ai-owner',email:'preview@example.invalid',password_hash:await bcrypt.hash('OrbitPreview123!',10),role:'admin',disabled:0,created_at:stamp,updated_at:stamp});
else if(db.getUserById('live-ai-owner')?.email!=='preview@example.invalid')throw new Error('测试账号不匹配');
const app=express();app.use(api.app);app.use(express.static(path.resolve('dist')));app.get('*',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
const server=app.listen(port,'127.0.0.1',()=>console.log(`Live AI sandbox: http://127.0.0.1:${port}/assistant; data=${root}; synthetic login preview@example.invalid / OrbitPreview123!`));
function stop(){server.closeAllConnections();server.close(()=>process.exit(0));}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
