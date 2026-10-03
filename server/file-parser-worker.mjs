// Worker accepts only bytes. It never opens URLs, executes document code, or renders HTML.
import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
import path from 'node:path';
try {
  const bytes=new Uint8Array(workerData.bytes),mime=workerData.mime;
  const blocks=[];let size=0,truncated=false;
  const add=(location,text)=>{if(size>=1000000){truncated=true;return;}text=String(text).replace(/\u0000/g,'');if(text.length>1000000-size)truncated=true;text=text.slice(0,1000000-size);size+=text.length;blocks.push({location,text});};
  if(mime==='application/pdf') {
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const require=createRequire(import.meta.url),packageRoot=path.dirname(require.resolve('pdfjs-dist/package.json'));
    const task=getDocument({data:bytes,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,disableAutoFetch:true,disableStream:true,standardFontDataUrl:path.join(packageRoot,'standard_fonts').replace(/\\/g,'/')+'/',cMapUrl:path.join(packageRoot,'cmaps').replace(/\\/g,'/')+'/',cMapPacked:true});
    const pdf=await task.promise;
    try{if(pdf.numPages>100)throw new Error('PDF 最多支持 100 页');for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),content=await page.getTextContent();add(`第 ${i} 页`,content.items.map(item=>'str'in item?item.str+(item.hasEOL?'\n':' '):'').join(''));page.cleanup();}}finally{await task.destroy();}
    if(!blocks.some(b=>b.text.trim()))throw new Error('PDF 没有可提取正文，可能是扫描件；当前不提供 OCR，请上传文字版');
  } else if(['text/plain','text/markdown'].includes(mime)) {
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);for(let i=0;i<text.length;i+=4000)add(`字符 ${i+1}–${Math.min(i+4000,text.length)}`,text.slice(i,i+4000));
  } else throw new Error('文档解析类型尚未开放');
  parentPort.postMessage({blocks,truncated});
}catch(error){parentPort.postMessage({error:error?.name==='PasswordException'?'不支持加密 PDF':error?.message||'文档解析失败'});}
