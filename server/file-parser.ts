import {Worker} from 'node:worker_threads';
export interface FileExtraction {blocks:Array<{location:string;text:string}>;truncated:boolean}
let active=0;
export function parseDocument(bytes:Buffer,mime:string,signal?:AbortSignal,timeoutMs=15000):Promise<FileExtraction> {
  signal?.throwIfAborted();if(active>=2)return Promise.reject(new Error('文件解析繁忙，请稍后重试'));
  active++;
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./file-parser-worker.mjs',import.meta.url),{workerData:{bytes,mime},resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32}});
    let finished=false;
    const finish=(error?:Error,result?:FileExtraction)=>{if(finished)return;finished=true;active--;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(result!);};
    const abort=()=>finish(new Error('解析已取消'));
    const timer=setTimeout(()=>finish(new Error('文件解析超时，请使用较小的文件')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    worker.once('message',result=>{if(result?.error)finish(new Error(result.error));else if(!Array.isArray(result?.blocks)||JSON.stringify(result).length>1100000)finish(new Error('解析结果超限'));else finish(undefined,result);});
    worker.once('error',error=>finish(error));worker.once('exit',code=>{if(!finished)finish(new Error('文件解析中断：'+code));});
  });
}
