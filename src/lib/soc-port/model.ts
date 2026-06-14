import { callOpenRouterJson, type ChatMessage, type UsageResult } from '../openrouter';
import { buildSocPortSystemPrompt, buildSocPortUserPrompt } from './prompts';
import { imageDataUrl } from './screenshot';
import { parseSocOperations } from './validator';
import type { SocPortMode, SocPortOcrItem, SocPortOperation, SocPortScreenshot, SocPortTurnLog } from './types';

export async function callSocPortModel(args: {
  mode: SocPortMode;
  objective: string;
  screenshot: SocPortScreenshot;
  labeledScreenshotBase64?: string;
  ocr: SocPortOcrItem[];
  labels?: Record<string, [number, number, number, number]>;
  history: SocPortTurnLog[];
  model: string;
  fallbackModel: string;
  userId: string;
}): Promise<{ operations: SocPortOperation[]; raw: string; model: string; usage: UsageResult }> {
  const imageBase64 = args.mode === 'labeled' && args.labeledScreenshotBase64
    ? args.labeledScreenshotBase64
    : args.screenshot.base64;
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSocPortSystemPrompt(args.mode, args.objective) },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: buildSocPortUserPrompt({
            mode: args.mode,
            objective: args.objective,
            history: args.history,
            ocr: args.ocr,
            labels: args.labels,
          }),
        },
        { type: 'image_url', image_url: { url: imageDataUrl(args.screenshot, imageBase64) } },
      ],
    },
  ];

  try {
    return await callAndParse(messages, args.model, args.userId);
  } catch (error) {
    if (args.model === args.fallbackModel) throw error;
    return callAndParse(messages, args.fallbackModel, args.userId);
  }
}

async function callAndParse(messages: ChatMessage[], model: string, userId: string) {
  const response = await callOpenRouterJson(messages, model, userId, false);
  try {
    return {
      operations: parseSocOperations(response.content),
      raw: response.content,
      model,
      usage: response.usage,
    };
  } catch (error) {
    const repair = await callOpenRouterJson([
      { role: 'system', content: 'Repair the content into only a valid JSON array of Self-Operating Computer operations: click, write, press, done.' },
      { role: 'user', content: `Validation error: ${error instanceof Error ? error.message : String(error)}\n\nContent:\n${response.content}` },
    ], model, userId, false);
    return {
      operations: parseSocOperations(repair.content),
      raw: repair.content,
      model,
      usage: {
        inputTokens: response.usage.inputTokens + repair.usage.inputTokens,
        outputTokens: response.usage.outputTokens + repair.usage.outputTokens,
        costUsd: response.usage.costUsd + repair.usage.costUsd,
        model,
      },
    };
  }
}
