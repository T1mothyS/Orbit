import {inflateRawSync} from 'node:zlib';
// Read-only ZIP preflight. No extraction to paths; worker verifies actual inflated sizes.
export function validateOfficeArchive(input,mime,verifyData=false){
  const bytes=Buffer.from(input);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('Office ZIP 目录损坏');
  const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
  if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||count>1000||count===65535||size>2000000||offset+size>end)throw new Error('Office ZIP 超限或格式不支持');
  let position=offset,total=0;const names=new Set();
  for(let i=0;i<count;i++){
    if(position+46>bytes.length||bytes.readUInt32LE(position)!==0x02014b50)throw new Error('Office ZIP 目录无效');
    const flags=bytes.readUInt16LE(position+8),method=bytes.readUInt16LE(position+10),compressed=bytes.readUInt32LE(position+20),expanded=bytes.readUInt32LE(position+24),n=bytes.readUInt16LE(position+28),extra=bytes.readUInt16LE(position+30),comment=bytes.readUInt16LE(position+32),local=bytes.readUInt32LE(position+42);
    const name=bytes.subarray(position+46,position+46+n).toString('utf8');
    if(names.has(name)||/^(?:\/|[a-z]:)|(?:^|[\/\\])\.\.(?:[\/\\]|$)/i.test(name)||flags&1||![0,8].includes(method))throw new Error('不支持加密、重复或不安全的 Office 内容');
    if(/vba|activex|embeddings\//i.test(name))throw new Error('不支持宏或嵌入可执行对象的 Office 文件');
    names.add(name);total+=expanded;if(expanded>10000000||total>40000000||expanded>Math.max(compressed,1)*100)throw new Error('Office 解压内容超限');
    if(verifyData){if(local+30>bytes.length||bytes.readUInt32LE(local)!==0x04034b50)throw new Error('Office ZIP 数据损坏');const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);if(start+compressed>offset)throw new Error('Office ZIP 数据超出边界');const chunk=bytes.subarray(start,start+compressed),data=method===8?inflateRawSync(chunk,{maxOutputLength:Math.max(1,expanded)}):chunk;if(data.length!==expanded)throw new Error('Office 解压大小与声明不符');if(name==='[Content_Types].xml'&&/macroEnabled|vbaProject/i.test(data.toString('utf8')))throw new Error('不支持宏文档');}
    position+=46+n+extra+comment;if(position>offset+size)throw new Error('Office ZIP 目录超出边界');
  }
  const required=mime.includes('wordprocessingml')?'word/document.xml':'xl/workbook.xml';if(!names.has('[Content_Types].xml')||!names.has(required))throw new Error('文件内容与 Office 类型不一致');return names;
}
