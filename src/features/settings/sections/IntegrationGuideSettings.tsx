import { useCallback,useEffect,useState } from 'react';
import { Button, HelpPopover } from '../../../ui';
import { SettingRow,SettingSection } from "../SettingFields";
import { useSettingsFeedback,useSettingsRequest } from '../SettingsState';
import type { SettingsAuthHeaders } from '../types';
interface GuideItem {
    id: string;
    title: string;
    purpose: string;
    configuration: string;
    steps: string[];
    test: string;
    commonFailures: string[];
    boundary: string;
}
interface GuideRule {
    id: string;
    title: string;
    rule: string;
}
interface GuideExample {
    title: string;
    prompt: string;
    expected: string;
}
interface GuideResponse {
    version: string;
    title: string;
    items: GuideItem[];
    rules: GuideRule[];
    examples: GuideExample[];
}
export function IntegrationGuideSettings({ authHeaders }: {
    authHeaders: SettingsAuthHeaders;
}) {
    const settingsFetch = useSettingsRequest();
    const feedback = useSettingsFeedback();
    const [guide, setGuide] = useState<GuideResponse | null>(null);
    const [loadError, setLoadError] = useState('');
    const loadGuide = useCallback(async () => {
        setLoadError('');
        try {
            const response = await settingsFetch('/api/ai-linkage-guides', { headers: authHeaders() });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result?.error || '读取接入指南失败');
            setGuide(result as GuideResponse);
        }
        catch (error: any) {
            setLoadError(error?.message || '接入指南加载失败，请重试。');
        }
    }, [authHeaders]);
    useEffect(() => { void loadGuide(); }, [loadGuide]);
    const copyPrompt = async (prompt: string) => {
        try {
            await navigator.clipboard.writeText(prompt);
            feedback.success('提示词已复制');
        }
        catch {
            feedback.error('自动复制失败，请手动选择提示词');
        }
    };
    return (<SettingSection id="guides" title="接入与联动指南" description="只读说明各个外部接入的配置位置、测试入口、失败边界和 AI 联动规则。这里不会显示或编辑任何密钥、动态日程上下文或运行时敏感信息。">
      {loadError && <div className="settings-status" role="alert"><span>{loadError}</span><Button variant="secondary" onClick={loadGuide}>重试指南</Button></div>}
      {!guide && !loadError && <p className="settings-help" role="status">加载接入指南中…</p>}
      {guide && <>
        <div className="settings-guide-meta" role="status">
          <strong>{guide.title}</strong>
          <span>规则版本：{guide.version}</span>
        </div>
        <div className="settings-guide-grid">
          {guide.items.map(item => (<article className="settings-guide-card" key={item.id}>
              <div className="settings-heading-with-help"><h3>{item.title}</h3><HelpPopover label={item.title}>
              <p><strong>用途：</strong>{item.purpose}</p>
              <p><strong>配置位置：</strong>{item.configuration}</p>
              <div className="settings-guide-block"><strong>首次配置</strong><ol>{item.steps.map(step => <li key={step}>{step}</li>)}</ol></div>
              <p><strong>测试入口：</strong>{item.test}</p>
              <div className="settings-guide-block"><strong>常见失败</strong><ul>{item.commonFailures.map(reason => <li key={reason}>{reason}</li>)}</ul></div>
              <p className="settings-guide-boundary"><strong>权限边界：</strong>{item.boundary}</p></HelpPopover></div>
            </article>))}
        </div>
        <SettingRow label="稳定联动规则" description="该版本规则同时注入日程助手和结构化导入，避免设置页文案与实际行为漂移。可复制到 AI 对话或项目提示词。">
          <div className="settings-guide-rules">
            <div className="settings-guide-rules-head"><Button variant="secondary" onClick={() => void copyPrompt(guide.rules.map(rule => `${rule.title}：${rule.rule}`).join('\n'))}>复制全部规则</Button></div>
            {guide.rules.map(rule => <div key={rule.id}><div className="settings-heading-with-help"><strong>{rule.title}</strong><HelpPopover label={rule.title}>{rule.rule}</HelpPopover></div></div>)}
          </div>
        </SettingRow>
        <SettingRow label="示例提示词" description="示例只读展示，可复制到 AI 对话中；提示词不会写入系统配置。">
          <div className="settings-guide-examples">{guide.examples.map(example => <article key={example.title} className="settings-guide-example">
            <div className="settings-guide-example-head"><strong>{example.title}</strong><Button variant="secondary" onClick={() => void copyPrompt(example.prompt)}>复制提示词</Button></div>
            <pre><code>{example.prompt}</code></pre>
            <HelpPopover label={`${example.title}预期结果`}>{example.expected}</HelpPopover>
          </article>)}</div>
        </SettingRow>
      </>}
    </SettingSection>);
}
