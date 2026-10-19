export function safeChatHref(value:string):string|undefined {
  if(/^\/(?!\/)[^\s<>\\]*$/.test(value))return value;
  try{const url=new URL(value);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;}catch{}return undefined;
}
