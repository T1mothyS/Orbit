// Worker accepts only bytes. It never opens URLs, executes document code, or renders HTML.
import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
import path from 'node:path';
import {validateOfficeArchive} from './archive-validation.mjs';
try {
  const bytes=new Uint8Array(workerData.bytes),mime=workerData.mime;
  const blocks=[];let size=0,truncated=false;
  const add=(location,text)=>{if(size>=1000000||blocks.length>=2000){truncated=true;return;}text=String(text).replace(/\u0000/g,'');if(text.length>1000000-size)truncated=true;text=text.slice(0,1000000-size);size+=text.length;blocks.push({location,text});};
  if(mime==='application/pdf') {
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const require=createRequire(import.meta.url),packageRoot=path.dirname(require.resolve('pdfjs-dist/package.json'));
    const task=getDocument({data:bytes,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,disableAutoFetch:true,disableStream:true,standardFontDataUrl:path.join(packageRoot,'standard_fonts').replace(/\\/g,'/')+'/',cMapUrl:path.join(packageRoot,'cmaps').replace(/\\/g,'/')+'/',cMapPacked:true});
    const pdf=await task.promise;
    try{if(pdf.numPages>100)throw new Error('PDF 最多支持 100 页');for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),content=await page.getTextContent();add(`第 ${i} 页`,content.items.map(item=>'str'in item?item.str+(item.hasEOL?'\n':' '):'').join(''));page.cleanup();}}finally{await task.destroy();}
    if(!blocks.some(b=>b.text.trim()))throw new Error('PDF 没有可提取正文，可能是扫描件；当前不提供 OCR，请上传文字版');
  } else if(['text/plain','text/markdown'].includes(mime)) {
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);for(let i=0;i<text.length;i+=4000)add(`字符 ${i+1}–${Math.min(i+4000,text.length)}`,text.slice(i,i+4000));
  } else if(mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    validateOfficeArchive(bytes,mime,true);const mammoth=await import('mammoth');
    const result=await mammoth.default.extractRawText({buffer:Buffer.from(bytes)},{externalFileAccess:false});
    const paragraphs=result.value.split(/\n\n+/);for(let i=0;i<paragraphs.length;i++)if(paragraphs[i].trim())add(`段落 ${i+1}`,paragraphs[i]);
  } else if(mime==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    validateOfficeArchive(bytes,mime,true);const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(bytes));
    let cells=0;if(book.worksheets.length>30)throw new Error('工作表数量不能超过 30');
    for(const sheet of book.worksheets){if(sheet.rowCount>1000)truncated=true;for(let row=1;row<=Math.min(sheet.rowCount,1000);row++){const values=[];sheet.getRow(row).eachCell({includeEmpty:false},(cell,column)=>{if(++cells>100000)throw new Error('表格单元格数量超限');const v=cell.value;let value=v;if(v&&typeof v==='object'){value='formula'in v||'sharedFormula'in v?v.result??'[公式未计算，未执行]':'richText'in v?v.richText.map(r=>r.text).join(''):'text'in v?v.text:v instanceof Date?v.toISOString():JSON.stringify(v);}values.push(`${column}: ${String(value??'').slice(0,4000)}`);});if(values.length)add(`工作表 ${sheet.name} · 第 ${row} 行`,values.join(' | '));}}
  } else if(mime==='text/csv') {
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let row=1,column=1,quoted=false,value='',values=[];
    const field=()=>{values.push(`${column++}: ${value.slice(0,4000)}`);value='';};const line=()=>{field();if(row<=1000)add(`CSV · 第 ${row} 行`,values.join(' | '));else truncated=true;row++;column=1;values=[];};
    for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(!quoted&&c===',')field();else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;line();}else value+=c;if(column>200||value.length>100000)throw new Error('CSV 字段超限');}if(quoted)throw new Error('CSV 引号不完整');if(value||values.length)line();
  } else throw new Error('文档解析类型尚未开放');
  parentPort.postMessage({blocks,truncated});
}catch(error){parentPort.postMessage({error:error?.name==='PasswordException'?'不支持加密 PDF':error?.message||'文档解析失败'});}
