import { callOpenRouterJson, type ChatMessage, type UsageResult } from '../openrouter';
import { buildSocSystemPrompt, buildSocUserPrompt } from './prompt';
import { screenshotDataUrl } from './screenshot';
import type { SocOperation, SocTurnContext } from './types';
import { validateSocOperations } from './validator';

export interface SocModelResult {
  operations: SocOperation[];
  raw: string;
  usage?: UsageResult;
  model: string;
}

export async function callSocModel(
  ctx: SocTurnContext,
  userId: string,
  fallbackModel: string,
): Promise<SocModelResult> {
  const imageBase64 = ctx.mode === 'labeled' || ctx.mode === 'hybrid-ocr-labeled'
    ? ctx.labeledScreenshotBase64
    : ctx.screenshot.base64;

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSocSystemPrompt(ctx.mode) },
    {
      role: 'user',
      content: [
        { type: 'text', text: buildSocUserPrompt(ctx) },
        { type: 'image_url', image_url: { url: screenshotDataUrl({ ...ctx.screenshot, base64: imageBase64 }) } },
      ],
    },
  ];

  try {
    return await callAndValidate(messages, ctx.model, userId);
  } catch (primaryError) {
    if (ctx.model === fallbackModel) throw primaryError;
    return callAndValidate(messages, fallbackModel, userId);
  }
}

async function callAndValidate(messages: ChatMessage[], model: string, userId: string): Promise<SocModelResult> {
  const response = await callOpenRouterJson(messages, model, userId, false);
  try {
    const operations = validateSocOperations(response.content);
    return { operations, raw: response.content, usage: response.usage, model };
  } catch (error) {
    const repairMessages: ChatMessage[] = [
      {
        role: 'system',
        content: 'Repair this model output into only a valid JSON array of SOC operations. Do not add markdown or commentary.',
      },
      {
        role: 'user',
        content: `Validation error: ${error instanceof Error ? error.message : String(error)}\n\nOutput to repair:\n${response.content}`,
      },
    ];
    const repaired = await callOpenRouterJson(repairMessages, model, userId, false);
    const operations = validateSocOperations(repaired.content);
    return {
      operations,
      raw: repaired.content,
      usage: {
        inputTokens: response.usage.inputTokens + repaired.usage.inputTokens,
        outputTokens: response.usage.outputTokens + repaired.usage.outputTokens,
        costUsd: response.usage.costUsd + repaired.usage.costUsd,
        model,
      },
      model,
    };
  }
}
