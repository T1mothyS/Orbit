import sharp from 'sharp';
import { queryOne, run } from './database/connection.js';
import { getAttachment, deleteAttachment } from './activity-store.js';
import { saveBase64Attachment, validateAttachmentBytes, deleteAttachmentFileIfUnused, readAttachment } from './attachment-service.js';
import { withPersistenceTransaction } from './persistence.js';
import { getUserById } from './db.js';
export function getProfile(userId:string) {const row=queryOne<{avatar_id:string|null}>('SELECT avatar_id FROM orbit_profiles WHERE user_id=?',[userId]);return {avatarId:row?.avatar_id&&getAttachment(row.avatar_id,userId)?row.avatar_id:null};}
export async function saveAvatar(userId:string,body:{mimeType?:unknown;base64?:unknown}) {
  if(!['image/png','image/jpeg','image/webp'].includes(String(body.mimeType))||typeof body.base64!=='string'||body.base64.length>7*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64))throw new Error('头像需要是 JPEG、PNG 或 WebP 图片');
  const bytes=Buffer.from(body.base64,'base64');if(bytes.length>5*1024*1024)throw new Error('头像不能超过 5 MB');
  validateAttachmentBytes(String(body.mimeType),bytes);
  const encoded=await sharp(bytes,{limitInputPixels:16777216,animated:false}).rotate().resize(256,256,{fit:'cover'}).webp({quality:85}).toBuffer();
  if(!getUserById(userId)||getUserById(userId)?.disabled)throw new Error('账号已不可用');
  const old=getProfile(userId).avatarId;
  const saved=withPersistenceTransaction(()=>{const file=saveBase64Attachment({userId,importId:`avatar:${userId}`,originalName:'avatar.webp',mimeType:'image/webp',base64:encoded.toString('base64')});run('INSERT INTO orbit_profiles (user_id,avatar_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET avatar_id=excluded.avatar_id',[userId,file.id]);return file;});
  if(old&&old!==saved.id){const previous=deleteAttachment(old,userId);if(previous)deleteAttachmentFileIfUnused(previous);}return getProfile(userId);
}
export function removeAvatar(userId:string) {const old=getProfile(userId).avatarId;withPersistenceTransaction(()=>run('DELETE FROM orbit_profiles WHERE user_id=?',[userId]));if(old){const file=deleteAttachment(old,userId);if(file)deleteAttachmentFileIfUnused(file);}return {avatarId:null};}
export function avatarBytes(userId:string) {const id=getProfile(userId).avatarId,file=id?getAttachment(id,userId):null;if(!file)throw new Error('头像不存在');return readAttachment(file);}
