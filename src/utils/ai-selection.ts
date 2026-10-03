export type AiProvider = 'workbuddy' | 'chatgpt';
export interface AiSelection { provider: AiProvider; models: Partial<Record<AiProvider, string>> }
export interface SelectableModel { id: string; name: string }

export function parseAiSelection(value: unknown): AiSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型偏好格式不正确');
  const selection = value as Record<string, unknown>;
  if (selection.provider !== 'workbuddy' && selection.provider !== 'chatgpt') throw new Error('AI 服务无效');
  if (!selection.models || typeof selection.models !== 'object' || Array.isArray(selection.models)) throw new Error('模型偏好格式不正确');
  const models: AiSelection['models'] = {};
  for (const [provider, id] of Object.entries(selection.models)) {
    if (!['workbuddy', 'chatgpt'].includes(provider) || typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 200 || /[\x00-\x1f\x7f]/.test(id)) throw new Error('模型名称无效');
    models[provider as AiProvider] = id;
  }
  if (!models[selection.provider]) throw new Error('请选择具体模型');
  return { provider: selection.provider, models };
}

/** A saved ID is exact: catalog ordering and new versions never replace it. */
export function initialModel(provider: AiProvider, models: SelectableModel[], remembered?: string, workBuddyDefault?: string): string {
  if (remembered) return remembered;
  if (provider === 'chatgpt') return models.find(model => /luna/i.test(model.id + ' ' + model.name))?.id || '';
  return workBuddyDefault || models[0]?.id || '';
}
