/** Render citations in first-reference order and separate unreferenced candidates. */
export function selectKnowledgeReferences<T extends {
    id: string;
}>(reply: string, ids: unknown, candidates: T[]) {
    const mentioned = [...reply.matchAll(/\[知识:([^\]]+)\]/g)].map(match => match[1]);
    const requested = mentioned.length ? mentioned : Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
    const unique = [...new Set(requested)].filter(id => candidates.some(item => item.id === id));
    const sources = [
        ...unique.map(id => ({ ...candidates.find(item => item.id === id)!, referenced: true })),
        ...candidates.filter(item => !unique.includes(item.id)).map(item => ({ ...item, referenced: false })),
    ];
    return { sources, reply: reply.replace(/\[知识:([^\]]+)\]/g, (_, id) => unique.includes(id) ? `[${unique.indexOf(id) + 1}]` : '') };
}
