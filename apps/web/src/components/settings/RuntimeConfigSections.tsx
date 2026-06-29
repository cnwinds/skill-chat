import type { ReactNode } from 'react';
import type { ImageConfig, SystemSettings, WebSearchConfig } from '@skillchat/shared';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';

const selectClassName =
  'h-9 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent';

const NativePolicySelect = ({
  value,
  onChange,
  label,
}: {
  value: 'auto' | 'on' | 'off';
  onChange: (value: 'auto' | 'on' | 'off') => void;
  label: string;
}) => (
  <label className="flex flex-col gap-1 text-sm">
    <span className="text-xs text-foreground-muted">{label}</span>
    <select className={selectClassName} value={value} onChange={(e) => onChange(e.target.value as 'auto' | 'on' | 'off')}>
      <option value="auto">auto（官方端点自动开启）</option>
      <option value="on">on（强制开启）</option>
      <option value="off">off（关闭，使用三方 Provider）</option>
    </select>
  </label>
);

const ProviderKeyAccordion = ({
  title,
  subtitle,
  configured,
  children,
}: {
  title: string;
  subtitle: string;
  configured: boolean;
  children: ReactNode;
}) => (
  <AccordionItem value={title} className="border-border">
    <AccordionTrigger className="py-2 text-sm hover:no-underline">
      <span className="flex flex-1 items-center gap-2 text-left">
        <span>{title}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-2xs ${configured ? 'bg-accent/15 text-accent' : 'bg-muted text-foreground-muted'}`}
        >
          {configured ? '已配置' : '未配置'}
        </span>
      </span>
      <span className="mr-2 text-2xs font-normal text-foreground-muted">{subtitle}</span>
    </AccordionTrigger>
    <AccordionContent className="pb-3 pt-1">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </AccordionContent>
  </AccordionItem>
);

export const ConfigGuideCallout = () => (
  <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-2xs leading-relaxed text-foreground-muted">
    <strong className="text-foreground">能力配置指引</strong>
    <p className="mt-1">
      聊天模型决定对话与推理；联网搜索与图片生成可独立配置 Native 通道或三方 Provider。
      Native 复用上方聊天 API Key；三方 Provider 填写 Key 后即激活。详见 HarnessKit{' '}
      <a
        href="https://github.com/harnesskit/harness-kit/blob/main/docs/ADVANCED.md"
        target="_blank"
        rel="noreferrer"
        className="text-accent underline-offset-2 hover:underline"
      >
        ADVANCED.md
      </a>
      。
    </p>
  </div>
);

export interface RuntimeConfigSectionsProps {
  draft: SystemSettings;
  onChange: (updater: (current: SystemSettings) => SystemSettings) => void;
}

export const RuntimeConfigSections = ({ draft, onChange }: RuntimeConfigSectionsProps) => {
  const updateWebSearch = (patch: Partial<WebSearchConfig>) => {
    onChange((current) => ({
      ...current,
      webSearchConfig: { ...current.webSearchConfig, ...patch },
    }));
  };

  const updateImage = (patch: Partial<ImageConfig>) => {
    onChange((current) => ({
      ...current,
      imageConfig: { ...current.imageConfig, ...patch },
    }));
  };

  const webSearchDisabled = draft.webSearchConfig.mode === 'disabled';
  const hasTavily = Boolean(draft.webSearchConfig.tavilyApiKey.trim());
  const hasSerper = Boolean(draft.webSearchConfig.serperApiKey.trim());
  const hasBrave = Boolean(draft.webSearchConfig.braveSearchApiKey.trim());
  const hasOpenAiImages = Boolean(draft.imageConfig.openaiImageApiKey.trim());
  const hasZhipu = Boolean(draft.imageConfig.zhipuImageApiKey.trim());
  const hasBailian = Boolean(draft.imageConfig.dashscopeImageApiKey.trim());

  return (
    <div className="flex flex-col gap-3">
      <ConfigGuideCallout />

      <Accordion type="multiple" defaultValue={['model', 'web-search', 'image']} className="flex flex-col gap-2">
        <AccordionItem value="model" className="rounded-lg border border-border bg-surface px-3">
          <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
            聊天模型
            <span className="ml-2 text-2xs font-normal text-foreground-muted">
              {draft.modelConfig.openaiModel}
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">OpenAI Base URL</span>
                <Input
                  value={draft.modelConfig.openaiBaseUrl}
                  onChange={(e) =>
                    onChange((c) => ({
                      ...c,
                      modelConfig: { ...c.modelConfig, openaiBaseUrl: e.target.value },
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">OpenAI API Key</span>
                <Input
                  type="password"
                  value={draft.modelConfig.openaiApiKey}
                  onChange={(e) =>
                    onChange((c) => ({
                      ...c,
                      modelConfig: { ...c.modelConfig, openaiApiKey: e.target.value },
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">OpenAI Model</span>
                <Input
                  value={draft.modelConfig.openaiModel}
                  onChange={(e) =>
                    onChange((c) => ({
                      ...c,
                      modelConfig: { ...c.modelConfig, openaiModel: e.target.value },
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">Reasoning Effort</span>
                <select
                  className={selectClassName}
                  value={draft.modelConfig.openaiReasoningEffort}
                  onChange={(e) =>
                    onChange((c) => ({
                      ...c,
                      modelConfig: {
                        ...c.modelConfig,
                        openaiReasoningEffort: e.target
                          .value as SystemSettings['modelConfig']['openaiReasoningEffort'],
                      },
                    }))
                  }
                >
                  <option value="minimal">minimal</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">LLM Max Output Tokens</span>
                <Input
                  type="number"
                  min={1}
                  value={String(draft.modelConfig.llmMaxOutputTokens)}
                  onChange={(e) =>
                    onChange((c) => ({
                      ...c,
                      modelConfig: {
                        ...c.modelConfig,
                        llmMaxOutputTokens: Math.max(1, Number(e.target.value || c.modelConfig.llmMaxOutputTokens)),
                      },
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">Tool Max Output Tokens</span>
                <Input
                  type="number"
                  min={1}
                  value={String(draft.modelConfig.toolMaxOutputTokens)}
                  onChange={(e) =>
                    onChange((c) => ({
                      ...c,
                      modelConfig: {
                        ...c.modelConfig,
                        toolMaxOutputTokens: Math.max(1, Number(e.target.value || c.modelConfig.toolMaxOutputTokens)),
                      },
                    }))
                  }
                />
              </label>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="web-search" className="rounded-lg border border-border bg-surface px-3">
          <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
            联网搜索
            <span className="ml-2 text-2xs font-normal text-foreground-muted">
              {draft.webSearchConfig.mode}
              {!webSearchDisabled ? ` · Native ${draft.webSearchConfig.openaiNative}` : ''}
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-foreground-muted">搜索模式</span>
                  <select
                    className={selectClassName}
                    value={draft.webSearchConfig.mode}
                    onChange={(e) =>
                      updateWebSearch({ mode: e.target.value as WebSearchConfig['mode'] })
                    }
                  >
                    <option value="live">live（实时联网）</option>
                    <option value="cached">cached（缓存结果）</option>
                    <option value="disabled">disabled（关闭搜索）</option>
                  </select>
                </label>
                <NativePolicySelect
                  label="OpenAI Native 搜索"
                  value={draft.webSearchConfig.openaiNative}
                  onChange={(openaiNative) => updateWebSearch({ openaiNative })}
                />
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span className="text-xs text-foreground-muted">Provider 优先级（可选）</span>
                  <Input
                    placeholder="openai_native,tavily,serper,brave"
                    value={draft.webSearchConfig.providers}
                    onChange={(e) => updateWebSearch({ providers: e.target.value })}
                  />
                  <span className="text-2xs text-foreground-muted">
                    留空使用 HarnessKit 默认顺序；按从左到右尝试，首个可用 Provider 生效。
                  </span>
                </label>
              </div>

              {!webSearchDisabled ? (
                <Accordion type="multiple" className="rounded-md border border-border/70 px-2">
                  <ProviderKeyAccordion title="Tavily" subtitle="tavily.com" configured={hasTavily}>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                      <span className="text-xs text-foreground-muted">TAVILY_API_KEY</span>
                      <Input
                        type="password"
                        value={draft.webSearchConfig.tavilyApiKey}
                        onChange={(e) => updateWebSearch({ tavilyApiKey: e.target.value })}
                      />
                    </label>
                  </ProviderKeyAccordion>
                  <ProviderKeyAccordion title="Serper" subtitle="serper.dev" configured={hasSerper}>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                      <span className="text-xs text-foreground-muted">SERPER_API_KEY</span>
                      <Input
                        type="password"
                        value={draft.webSearchConfig.serperApiKey}
                        onChange={(e) => updateWebSearch({ serperApiKey: e.target.value })}
                      />
                    </label>
                  </ProviderKeyAccordion>
                  <ProviderKeyAccordion title="Brave Search" subtitle="brave.com/search/api" configured={hasBrave}>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                      <span className="text-xs text-foreground-muted">BRAVE_SEARCH_API_KEY</span>
                      <Input
                        type="password"
                        value={draft.webSearchConfig.braveSearchApiKey}
                        onChange={(e) => updateWebSearch({ braveSearchApiKey: e.target.value })}
                      />
                    </label>
                  </ProviderKeyAccordion>
                </Accordion>
              ) : (
                <p className="text-2xs text-foreground-muted">搜索已关闭，下方 Provider Key 不会生效。</p>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="image" className="rounded-lg border border-border bg-surface px-3">
          <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
            图片生成
            <span className="ml-2 text-2xs font-normal text-foreground-muted">
              Native {draft.imageConfig.openaiNative}
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NativePolicySelect
                  label="OpenAI Native 生图"
                  value={draft.imageConfig.openaiNative}
                  onChange={(openaiNative) => updateImage({ openaiNative })}
                />
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span className="text-xs text-foreground-muted">Provider 优先级（可选）</span>
                  <Input
                    placeholder="openai_images,zhipu,bailian"
                    value={draft.imageConfig.providers}
                    onChange={(e) => updateImage({ providers: e.target.value })}
                  />
                  <span className="text-2xs text-foreground-muted">
                    三方生图需填写对应 Key 与 Model；Native 生图复用聊天 API Key。
                  </span>
                </label>
              </div>

              <Accordion type="multiple" className="rounded-md border border-border/70 px-2">
                <ProviderKeyAccordion
                  title="OpenAI Images"
                  subtitle="gpt-image-2 等"
                  configured={hasOpenAiImages}
                >
                  <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                    <span className="text-xs text-foreground-muted">OPENAI_IMAGE_API_KEY</span>
                    <Input
                      type="password"
                      value={draft.imageConfig.openaiImageApiKey}
                      onChange={(e) => updateImage({ openaiImageApiKey: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-foreground-muted">Base URL</span>
                    <Input
                      value={draft.imageConfig.openaiImageBaseUrl}
                      onChange={(e) => updateImage({ openaiImageBaseUrl: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-foreground-muted">Model</span>
                    <Input
                      value={draft.imageConfig.openaiImageModel}
                      onChange={(e) => updateImage({ openaiImageModel: e.target.value })}
                    />
                  </label>
                </ProviderKeyAccordion>
                <ProviderKeyAccordion title="智谱 GLM-Image" subtitle="open.bigmodel.cn" configured={hasZhipu}>
                  <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                    <span className="text-xs text-foreground-muted">ZHIPU_IMAGE_API_KEY</span>
                    <Input
                      type="password"
                      value={draft.imageConfig.zhipuImageApiKey}
                      onChange={(e) => updateImage({ zhipuImageApiKey: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-foreground-muted">Base URL</span>
                    <Input
                      value={draft.imageConfig.zhipuImageBaseUrl}
                      onChange={(e) => updateImage({ zhipuImageBaseUrl: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-foreground-muted">Model</span>
                    <Input
                      value={draft.imageConfig.zhipuImageModel}
                      onChange={(e) => updateImage({ zhipuImageModel: e.target.value })}
                    />
                  </label>
                </ProviderKeyAccordion>
                <ProviderKeyAccordion title="百炼 / DashScope" subtitle="wan2.1-t2i-turbo 等" configured={hasBailian}>
                  <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                    <span className="text-xs text-foreground-muted">DASHSCOPE_IMAGE_API_KEY</span>
                    <Input
                      type="password"
                      value={draft.imageConfig.dashscopeImageApiKey}
                      onChange={(e) => updateImage({ dashscopeImageApiKey: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-foreground-muted">Base URL</span>
                    <Input
                      value={draft.imageConfig.dashscopeImageBaseUrl}
                      onChange={(e) => updateImage({ dashscopeImageBaseUrl: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-foreground-muted">Model</span>
                    <Input
                      value={draft.imageConfig.dashscopeImageModel}
                      onChange={(e) => updateImage({ dashscopeImageModel: e.target.value })}
                    />
                  </label>
                </ProviderKeyAccordion>
              </Accordion>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};
