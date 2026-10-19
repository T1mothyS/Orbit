import type { AiProvider } from '../utils/ai-selection';
import { OrbitSegmentedControl } from './OrbitSegmentedControl';
export function AiProviderSelect({ provider, disabled, onChange }: { provider: AiProvider; disabled?: boolean; onChange: (provider: AiProvider) => void }) {
  return <OrbitSegmentedControl label="AI 服务" value={provider} disabled={disabled} onChange={onChange}
    options={[{ value: 'workbuddy', label: 'WorkBuddy' }, { value: 'chatgpt', label: 'ChatGPT' }]} />;
}
