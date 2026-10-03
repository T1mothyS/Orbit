import type {AiStep,ProviderRequest} from './ai-provider-contract.js';
import type {WebSource} from './orbit-search.js';

export interface WebCitation {marker:string;url:string;title:string}
export function webSource(raw:any):WebSource|undefined {
  if(typeof raw?.url!=='string'||raw.url.length>2048)return;
  try {
    const url=new URL(raw.url);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return;
    return {url:url.href,title:String(raw.title||url.hostname).slice(0,200),source:url.hostname,snippet:'',publishedAt:null,retrievedAt:new Date().toISOString()};
  } catch {return;}
}
const markerPattern=/\uE200cite\uE202[^\uE201]*\uE201/g;
export function collectWebSources(output:any[],request:ProviderRequest) {
  for(const item of output) {
    if(item.type==='web_search_call')for(const raw of (Array.isArray(item.action?.sources)?item.action.sources:[]).slice(0,20)) {
      const source=webSource(raw);if(source)request.onWebSource?.(source);
    }
    if(item.type!=='message')continue;
    for(const part of item.content||[])for(const annotation of (Array.isArray(part.annotations)?part.annotations:[]).slice(0,40)) {
      if(annotation.type!=='url_citation')continue;
      const source=webSource(annotation);if(!source)continue;
      request.onWebSource?.(source);
      const start=annotation.start_index,end=annotation.end_index;
      let marker='';
      if(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>=start&&typeof part.text==='string') {
        // Providers may report UTF-16 or Unicode character offsets. Only replace actual citation markers.
        const spans=[part.text.slice(start,end),Array.from(part.text).slice(start,end).join('')];
        marker=spans.map(span=>span.match(markerPattern)?.[0]).find(Boolean)||'';
      }
      request.onWebCitation?.({marker,url:source.url,title:source.title});
    }
  }
}
export function withWebCitations(reply:string,citations:WebCitation[]):string {
  const links=new Map<string,string>(),markers=new Map<string,Set<string>>();
  for(const citation of citations) {
    const source=webSource(citation);if(!source)continue;
    const label=source.title.replace(/[\[\]\\`\r\n]/g,'').trim()||source.source;
    const link=`[${label}](${source.url.replace(/\(/g,'%28').replace(/\)/g,'%29')})`;
    links.set(source.url,link);
    if(citation.marker){const urls=markers.get(citation.marker)||new Set<string>();urls.add(source.url);markers.set(citation.marker,urls);}
  }
  const placed=new Set<string>();
  for(const [marker,urls] of markers)if(reply.includes(marker)) {
    reply=reply.split(marker).join([...urls].map(url=>{placed.add(url);return links.get(url);}).join('、'));
  }
  reply=reply.replace(markerPattern,'');
  const remaining=[...links].filter(([url])=>!placed.has(url)).map(([,link])=>link);
  return reply+(remaining.length?'\n\n参考来源：'+remaining.join(' · '):'');
}
export function webSearchStep(item:any,id:string,at:string,state:AiStep['state']):AiStep {
  const action=item?.action||{};
  const label=action.type==='open_page'?'ChatGPT 读取网页':action.type==='find_in_page'?'ChatGPT 查找网页内容':'ChatGPT 联网搜索';
  const query=Array.isArray(action.queries)?action.queries.join('；'):action.query||action.url||'';
  return {id,label,state,query:String(query).slice(0,300),at};
}
