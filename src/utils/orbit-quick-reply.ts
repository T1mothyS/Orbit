export const orbitQuickReplies = {
  draft: '整理成待确认日程',
  discuss: '先讨论这件事',
} as const;

export type OrbitQuickReplyChoice = keyof typeof orbitQuickReplies;
export type OrbitQuickReply = { messageId: string; choice: OrbitQuickReplyChoice };
