import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";

/**
 * Gemini client wrapper — free-tier aware.
 *
 *  • Per-user API key (encrypted in Settings) with fallback to the server key.
 *  • Model tiering: `fast` (extraction/classification) vs `smart` (generation).
 *  • Daily call budget per user (AiUsage) so a runaway pipeline can't burn quota.
 *  • Retries with exponential backoff on 429/5xx (free tier rate limits).
 *  • generateJSON<T>: JSON-mode output validated against a Zod schema.
 */

export type ModelTier = "fast" | "smart";

export class AiBudgetExceededError extends Error {
  constructor(limit: number) {
    super(`Daily AI call budget of ${limit} reached. Try again tomorrow or raise the budget in Settings.`);
    this.name = "AiBudgetExceededError";
  }
}

/** Thrown when the user hasn't configured their own Gemini key yet. */
export class AiKeyMissingError extends Error {
  constructor() {
    super(
      "Add your own free Gemini API key in Settings → AI first — every account uses its own key."
    );
    this.name = "AiKeyMissingError";
  }
}

interface UserAiConfig {
  apiKey: string;
  fastModel: string;
  smartModel: string;
  dailyBudget: number;
}

async function getUserAiConfig(userId: string): Promise<UserAiConfig> {
  const settings = await prisma.setting.findUnique({ where: { userId } });
  // Every account must bring its own key — there is deliberately no shared
  // server fallback, so one user can never consume another's free-tier quota.
  if (!settings?.geminiApiKeyEnc) {
    throw new AiKeyMissingError();
  }
  return {
    apiKey: decrypt(settings.geminiApiKeyEnc),
    fastModel: settings?.aiFastModel ?? env.geminiFastModel,
    smartModel: settings?.aiSmartModel ?? env.geminiSmartModel,
    dailyBudget: settings?.aiDailyBudget ?? 200,
  };
}

/** UTC day bucket used for quota accounting. */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function checkAndRecordUsage(
  userId: string,
  model: string,
  budget: number,
  usage: { input: number; output: number }
): Promise<void> {
  const date = todayUtc();
  const rows = await prisma.aiUsage.findMany({ where: { userId, date } });
  const totalCalls = rows.reduce((sum, r) => sum + r.calls, 0);
  if (totalCalls >= budget) throw new AiBudgetExceededError(budget);

  await prisma.aiUsage.upsert({
    where: { userId_date_model: { userId, date, model } },
    create: {
      userId,
      date,
      model,
      calls: 1,
      inputTokens: usage.input,
      outputTokens: usage.output,
    },
    update: {
      calls: { increment: 1 },
      inputTokens: { increment: usage.input },
      outputTokens: { increment: usage.output },
    },
  });
}

async function preflightBudget(userId: string, budget: number): Promise<void> {
  const rows = await prisma.aiUsage.findMany({
    where: { userId, date: todayUtc() },
  });
  const totalCalls = rows.reduce((sum, r) => sum + r.calls, 0);
  if (totalCalls >= budget) throw new AiBudgetExceededError(budget);
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    const e = error as { status?: number; code?: number };
    return e.status ?? e.code;
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GenerateOptions {
  userId: string;
  tier?: ModelTier;
  /** Override the tier-resolved model (Settings → AI Model Selection). */
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
}

/** Low-level text generation with retries + usage accounting. */
export async function generateText(
  prompt: string,
  options: GenerateOptions
): Promise<string> {
  const config = await getUserAiConfig(options.userId);
  await preflightBudget(options.userId, config.dailyBudget);

  const model =
    options.model ??
    (options.tier === "smart" ? config.smartModel : config.fastModel);
  const ai = new GoogleGenAI({ apiKey: config.apiKey });

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxOutputTokens ?? 4096,
          ...(options.systemInstruction
            ? { systemInstruction: options.systemInstruction }
            : {}),
        },
      });

      const text = response.text ?? "";
      await checkAndRecordUsage(options.userId, model, config.dailyBudget, {
        input: response.usageMetadata?.promptTokenCount ?? 0,
        output: response.usageMetadata?.candidatesTokenCount ?? 0,
      });
      return text;
    } catch (error) {
      lastError = error;
      const status = statusOf(error);
      if (error instanceof AiBudgetExceededError) throw error;
      if (status !== undefined && !RETRYABLE.has(status)) throw error;
      if (attempt < MAX_RETRIES) {
        // 2s, 8s, 32s — generous because free-tier 429s reset per minute.
        await sleep(2000 * Math.pow(4, attempt) * (0.5 + Math.random()));
      }
    }
  }
  throw lastError;
}

/**
 * JSON-mode generation validated with Zod.
 * Retries once with the validation error appended if the model returns a
 * malformed shape (rare with responseMimeType json, but free-tier models drift).
 */
export async function generateJSON<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options: GenerateOptions
): Promise<T> {
  const config = await getUserAiConfig(options.userId);
  await preflightBudget(options.userId, config.dailyBudget);

  const model =
    options.model ??
    (options.tier === "smart" ? config.smartModel : config.fastModel);
  const ai = new GoogleGenAI({ apiKey: config.apiKey });

  let currentPrompt = prompt;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: currentPrompt,
        config: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxOutputTokens ?? 8192,
          responseMimeType: "application/json",
          ...(options.systemInstruction
            ? { systemInstruction: options.systemInstruction }
            : {}),
        },
      });

      await checkAndRecordUsage(options.userId, model, config.dailyBudget, {
        input: response.usageMetadata?.promptTokenCount ?? 0,
        output: response.usageMetadata?.candidatesTokenCount ?? 0,
      });

      const parsed = extractJson(response.text ?? "");
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;

      // Shape drift — feed the error back once, then bail.
      lastError = new Error(`AI returned invalid JSON shape: ${result.error.message}`);
      currentPrompt = `${prompt}\n\nYour previous response failed validation with: ${result.error.message}\nReturn ONLY corrected JSON.`;
    } catch (error) {
      lastError = error;
      const status = statusOf(error);
      if (error instanceof AiBudgetExceededError) throw error;
      if (status !== undefined && !RETRYABLE.has(status)) throw error;
      if (attempt < MAX_RETRIES) {
        await sleep(2000 * Math.pow(4, attempt) * (0.5 + Math.random()));
      }
    }
  }
  throw lastError;
}

/** Tolerant JSON extraction — strips markdown fences and leading prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.search(/[[{]/);
  if (start >= 0) {
    const openChar = trimmed[start];
    const closeChar = openChar === "{" ? "}" : "]";
    const end = trimmed.lastIndexOf(closeChar);
    if (end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
  }
  throw new Error("Model response contained no parseable JSON");
}
