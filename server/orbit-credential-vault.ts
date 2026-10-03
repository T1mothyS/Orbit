import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
const root=path.resolve(process.env.DATA_DIR||'data','.orbit-secrets');
function vaultKey():Buffer {
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const configured=process.env.ORBIT_CREDENTIALS_ENCRYPTION_KEY;
  if(configured)return createHash('sha256').update(configured).digest();
  const file=path.join(root,'key');
  if(!fs.existsSync(file)){try{fs.writeFileSync(file,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(!fs.existsSync(file))throw e;}}
  const key=fs.readFileSync(file);if(key.length!==32)throw new Error('Orbit 凭据密钥不可用');return key;
}
const fileFor=(scope:string,owner:string)=>path.join(root,createHash('sha256').update(scope+'\0'+owner).digest('hex')+'.enc');
export function loadSecret<T>(scope:string,owner:string):T|undefined {
  const file=fileFor(scope,owner);if(!fs.existsSync(file))return undefined;
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  const decipher=createDecipheriv('aes-256-gcm',vaultKey(),Buffer.from(data.iv,'base64'));decipher.setAAD(Buffer.from(scope+'\0'+owner));decipher.setAuthTag(Buffer.from(data.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.value,'base64')),decipher.final()]).toString('utf8'));
}
export function saveSecret(scope:string,owner:string,value:unknown):void {
  const key=vaultKey(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(scope+'\0'+owner));
  const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  const file=fileFor(scope,owner),temp=file+'.'+randomUUID()+'.tmp';
  const fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),value:bytes.toString('base64')}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export function removeSecret(scope:string,owner:string):void {const f=fileFor(scope,owner);if(fs.existsSync(f))fs.unlinkSync(f);}
export async function withSecretLock<T>(scope:string,owner:string,work:()=>Promise<T>):Promise<T> {
  vaultKey();const file=fileFor(scope,owner)+'.lock';
  let fd:number;try{fd=fs.openSync(file,'wx',0o600);}catch{throw new Error('凭据正在更新，请稍后重试；中断进程遗留的锁需在停服后清理');}
  try{return await work();}finally{fs.closeSync(fd);fs.unlinkSync(file);}
}
