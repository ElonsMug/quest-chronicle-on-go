import type { DMRequest } from "./dm-security.ts";

const PROVIDERS = {
  gemini: { model: "gemini-3.5-flash-lite", key: "GEMINI_API_KEY" },
  deepseek: { model: "deepseek-flash", key: "DEEPSEEK_API_KEY" },
} as const;

type Provider = keyof typeof PROVIDERS;
type Config = { provider: Provider; model: string; apiKey: string };
export type DmUsage = { input?: number; output?: number; cachedInput?: number; thinking?: number };
type Reply = { text: string; finish?: string; usage: DmUsage };
const outputLimit = 1200;

export function getDmConfig(env: Record<string, string | undefined>): Config | null {
  const provider = env.DM_PROVIDER?.trim() || "gemini";
  if (!Object.hasOwn(PROVIDERS, provider)) return null;
  const selected = provider as Provider;
  const { model, key } = PROVIDERS[selected];
  const apiKey = env[key]?.trim();
  return apiKey ? { provider: selected, model, apiKey } : null;
}

export class DmProviderError extends Error {
  readonly status: number;
  readonly providerCode?: string;

  constructor(status: number, providerCode?: string) {
    super("DM provider request failed");
    this.status = status;
    this.providerCode = providerCode;
  }
}

async function postJson<T>(url: string, headers: Record<string, string>, body: object): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { status?: unknown } } | null;
    const code = body?.error?.status;
    const knownCode = typeof code === "string" && ["UNAVAILABLE", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED", "INTERNAL"].includes(code)
      ? code : undefined;
    throw new DmProviderError(response.status, knownCode);
  }
  return (await response.json()) as T;
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
};

async function callGemini(config: Config, request: DMRequest): Promise<Reply> {
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  // The game displays the first scene without retaining its generated start request.
  if (request.messages[0]?.role === "assistant") {
    contents.push({ role: "user", parts: [{ text: "Begin the adventure." }] });
  }
  for (const message of request.messages) {
    const role = message.role === "assistant" ? "model" : "user";
    const preceding = contents.at(-1);
    const part = { text: message.content };
    if (preceding?.role === role) preceding.parts.push(part);
    else contents.push({ role, parts: [part] });
  }

  const isSetup = request.purpose === "one-shot-setup";
  const wantsJson = isSetup || request.purpose === "one-shot-intent";
  const result = await postJson<GeminiResponse>(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,
    { "x-goog-api-key": config.apiKey },
    {
      contents,
      systemInstruction: request.system ? { parts: [{ text: request.system }] } : undefined,
      generationConfig: {
        maxOutputTokens: isSetup ? 4200 : wantsJson ? 300 : outputLimit,
        ...(wantsJson ? { responseMimeType: "application/json" } : {}),
        thinkingConfig: { thinkingLevel: "MINIMAL" },
      },
    },
  );
  const candidate = result.candidates?.[0];
  const usage = result.usageMetadata;
  const text =
    candidate?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("") ?? "";
  return {
    text,
    finish: candidate?.finishReason ?? result.promptFeedback?.blockReason,
    usage: {
      input: usage?.promptTokenCount,
      output:
        usage?.candidatesTokenCount === undefined && usage?.thoughtsTokenCount === undefined
          ? undefined
          : (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      cachedInput: usage?.cachedContentTokenCount,
      thinking: usage?.thoughtsTokenCount,
    },
  };
}

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

async function callDeepSeek(config: Config, request: DMRequest): Promise<Reply> {
  const messages = request.system
    ? [{ role: "system", content: request.system }, ...request.messages]
    : request.messages;
  const result = await postJson<DeepSeekResponse>(
    "https://api.deepseek.com/chat/completions",
    { Authorization: `Bearer ${config.apiKey}` },
    { model: config.model, messages, max_tokens: outputLimit, thinking: { type: "disabled" } },
  );
  const choice = result.choices?.[0];
  return {
    text: choice?.message?.content ?? "",
    finish: choice?.finish_reason,
    usage: {
      input: result.usage?.prompt_tokens,
      output: result.usage?.completion_tokens,
      cachedInput: result.usage?.prompt_cache_hit_tokens,
      thinking: result.usage?.completion_tokens_details?.reasoning_tokens,
    },
  };
}

const generate = { gemini: callGemini, deepseek: callDeepSeek };

export async function generateDmResult(config: Config, request: DMRequest) {
  const started = Date.now();
  const reply = await generate[config.provider](config, request);
  console.info("[dm] generation", {
    provider: config.provider,
    model: config.model,
    purpose: request.purpose,
    latencyMs: Date.now() - started,
    finish: reply.finish,
    ...reply.usage,
  });
  const expectedFinish = config.provider === "gemini" ? "STOP" : "stop";
  if (!reply.text.trim() || (reply.finish && reply.finish !== expectedFinish)) {
    throw new DmProviderError(502);
  }
  return { text: reply.text, model: config.model, usage: reply.usage };
}

export async function generateDmReply(config: Config, request: DMRequest): Promise<string> {
  return (await generateDmResult(config, request)).text;
}
