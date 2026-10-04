export type OrbitObject = { type: 'schedule'|'reminder'|'note'|'conversation'|'setting'|'library'|'report'|'tool'|'activity-report'; id: string; date?: string; conversationId?: string; instanceId?: string };
export function orbitObjectPath(ref: OrbitObject): string {
  const id=encodeURIComponent(ref.id);
  switch(ref.type) {
    case 'schedule': return `/schedule?schedule=${id}${ref.date?`&date=${encodeURIComponent(ref.date)}`:''}`;
    case 'reminder': return `/reminders?task=${id}${ref.instanceId?`&cycle=${encodeURIComponent(ref.instanceId)}`:''}`;
    case 'note': return `/assistant?note=${id}`;
    case 'conversation': return `/assistant?conversation=${encodeURIComponent(ref.conversationId||ref.id)}${ref.conversationId?`&message=${id}`:''}`;
    case 'setting': return `/assistant?settings=${id}`;
    case 'library': return `/library/${id}`;
    case 'report': return `/reports/${id}`;
    case 'tool': return `/tools/${id}`;
    case 'activity-report': return `/project?view=statistics&report=${id}`;
  }
}
export function safeOrbitLink(raw: string, origin?: string): string | null {
  try {
    if(raw.startsWith('/')){const base=origin||'https://orbit.invalid';const url=new URL(raw,base);return url.origin===base&&!url.username&&!url.password?`${url.pathname}${url.search}${url.hash}`:null;}
    const url=new URL(raw);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null;
    return origin&&url.origin===origin?`${url.pathname}${url.search}${url.hash}`:url.href;
  } catch {return null;}
}
