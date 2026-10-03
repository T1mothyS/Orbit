import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {beginLocalChatGPTAuth,type ChatGPTCredential} from '../server/chatgpt-oauth.js';
const dir=path.join(os.homedir(),'.orbit','chatgpt');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const hostFile=path.join(dir,'host.json');if(!fs.existsSync(hostFile))fs.writeFileSync(hostFile,JSON.stringify({id:'urn:uuid:'+randomUUID()}),{flag:'wx',mode:0o600});
const args=process.argv.slice(2),profileArg=args.indexOf('--registration');
const old:ChatGPTCredential|undefined=profileArg>=0?JSON.parse(fs.readFileSync(path.resolve(args[profileArg+1]),'utf8')):undefined;
const auth=await beginLocalChatGPTAuth(JSON.parse(fs.readFileSync(hostFile,'utf8')).id,old);
console.log('请在系统浏览器完成 Orbit 的 ChatGPT 授权。此流程只创建授权文件，不调用模型。');
const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
const browser=spawn(command,process.platform==='win32'?['url.dll,FileProtocolHandler',auth.url]:[auth.url],{detached:true,stdio:'ignore',windowsHide:true});browser.on('error',()=>console.log('系统浏览器未能打开，请手动打开授权地址：\n'+auth.url));browser.unref();
try{const credential=await auth.result;const output=path.join(dir,'orbit-chatgpt-import.json');fs.writeFileSync(output,JSON.stringify(credential,null,2),{mode:0o600});console.log('授权文件已保存：'+output+'\n在 Orbit 设置 → AI → ChatGPT 导入该文件。导入后不要在本机刷新这份已转移会话，并删除传输副本；服务器负责后续刷新。');}catch(e){console.error(e instanceof Error?e.message:'授权失败');process.exitCode=1;}
