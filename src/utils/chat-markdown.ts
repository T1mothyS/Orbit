export type ChatInline = {type:'text'|'bold'|'code'|'link';text:string;href?:string};
export function safeChatHref(value:string):string|undefined {
  if(/^\/(?!\/)[^\s<>]*$/.test(value))return value;
  try{const url=new URL(value);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;}catch{}return undefined;
}
export function chatInline(text:string):ChatInline[] {
  const parts:ChatInline[]=[];const pattern=/\*\*([^*\n]+)\*\*|`([^`\n]+)`|(?<!!)\[([^\]\n]+)\]\(([^\s)]+)\)/g;let start=0;
  for(const match of text.matchAll(pattern)){const at=match.index!;if(at>start)parts.push({type:'text',text:text.slice(start,at)});if(match[1])parts.push({type:'bold',text:match[1]});else if(match[2])parts.push({type:'code',text:match[2]});else {const href=safeChatHref(match[4]);parts.push(href?{type:'link',text:match[3],href}:{type:'text',text:match[0]});}start=at+match[0].length;}
  if(start<text.length)parts.push({type:'text',text:text.slice(start)});return parts;
}
