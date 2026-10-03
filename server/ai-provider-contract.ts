/** Provider transport and Orbit tools deliberately share no business write authority. */
export type AiProviderId = 'workbuddy' | 'chatgpt';
export type CapabilityEvidence = 'unknown' | 'catalog' | 'verified';
export interface ModelCapability { supported: boolean | null; evidence: CapabilityEvidence }
export interface OrbitModel {
  id: string; name: string; provider: AiProviderId; description?: string;
  capabilities: { images: ModelCapability; tools: ModelCapability; files: ModelCapability };
  limits?: { images?: number; imageBytes?: number; context?: number };
}
export interface AiInputPart {
  type: 'text' | 'image' | 'file'; text?: string; data?: string; mime?: string; filename?: string;
}
export interface AiStep { id: string; label: string; state: 'running' | 'completed' | 'failed'; query?: string; at: string }
export interface OrbitTool {
  name: string; description: string; schema: Record<string, unknown>;
  execute(args: unknown, signal?: AbortSignal): Promise<unknown>;
}
export interface ProviderRequest {
  userId: string; model: string; instructions: string; input: AiInputPart[];
  controller?: AbortController; tools?: OrbitTool[]; onStep?: (step: AiStep) => void;
}
export interface AiProvider { id: AiProviderId; generate(request: ProviderRequest): Promise<string> }
const capability = (value: unknown): ModelCapability => ({ supported: typeof value === 'boolean' ? value : null, evidence: typeof value === 'boolean' ? 'catalog' : 'unknown' });
export function workBuddyModel(raw: Record<string, any>): OrbitModel {
  return { id: String(raw.modelId || raw.id || raw.slug), name: String(raw.modelName || raw.name || raw.modelId || raw.id || raw.slug), provider: 'workbuddy', description: raw.description,
    capabilities: { images: capability(raw.disabledMultimodal === true ? false : raw.supportsImages), tools: capability(raw.supportsToolCall), files: capability(undefined) },
    limits: { images: raw.maxImageCount, imageBytes: raw.maxAllowedSize, context: raw.contextWindow } };
}
export const ORBIT_TOOL_LIMITS = Object.freeze({ rounds: 4, calls: 6, searches: 2, results: 5 });
