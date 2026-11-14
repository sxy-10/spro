/**
 * DeepSeek 大模型客户端（OpenAI 兼容协议）。
 *
 * 安全约定：
 * - API Key 只从环境变量 process.env.DEEPSEEK_API_KEY 读取，绝不写入代码、数据库或日志；
 * - 所有日志只输出模型名 / 耗时 / token 用量，出错信息做脱敏；
 * - 未配置密钥或调用失败时统一返回 null，由调用方平滑回退到本地规则引擎。
 */
const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-flash';
const FALLBACK_MODEL = 'deepseek-chat';

export interface LlmMeta {
  provider: 'deepseek';
  base_url: string;
  model: string;
  key_configured: boolean;
  enabled: boolean;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
  /** 是否启用思考模式（仅对 flash / reasoner 类模型下发） */
  thinking?: boolean;
}

/** 进程内缓存：模型不可用时会自动降级到 deepseek-chat 并记住结果 */
let resolvedModel: string | null = null;

export function llmKey(): string {
  return (process.env.DEEPSEEK_API_KEY || '').trim();
}

export function llmBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

export function llmModel(): string {
  return resolvedModel || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
}

export function llmEnabled(): boolean {
  return llmKey().length > 0 && process.env.AI_DISABLED !== '1';
}

export function llmInfo(): LlmMeta {
  return {
    provider: 'deepseek',
    base_url: llmBaseUrl(),
    model: llmModel(),
    key_configured: llmKey().length > 0,
    enabled: llmEnabled(),
  };
}

/** 日志脱敏：把可能出现的密钥片段替换掉 */
function sanitize(text: string): string {
  const key = llmKey();
  let out = String(text || '');
  if (key.length >= 8) out = out.split(key).join('sk-***');
  return out.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***').slice(0, 500);
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResult {
  content: string;
  model: string;
  latencyMs: number;
  finishReason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

async function callOnce(messages: ChatMessage[], model: string, opts: ChatOptions): Promise<ChatResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60000);
  const started = Date.now();

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 2048,
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  // 思考模式：flash/reasoner 系模型默认开启思考，但长 JSON 输出会把 completion 预算吃满导致截断，
  // 因此默认显式关闭；需要深度推理时用 DEEPSEEK_THINKING=1 或 opts.thinking=true 开启。
  const thinkingOn = opts.thinking ?? (process.env.DEEPSEEK_THINKING === '1');
  if (/flash|reason/i.test(model)) {
    if (thinkingOn) {
      body.reasoning_effort = 'high';
      body.thinking = { type: 'enabled' };
    } else {
      body.thinking = { type: 'disabled' };
    }
  }

  try {
    const res = await fetch(`${llmBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmKey()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`DeepSeek HTTP ${res.status}: ${sanitize(text)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const json = JSON.parse(text) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
      usage?: ChatResult['usage'];
    };
    const choice = json.choices?.[0];
    // 注意：思考模式下 reasoning_tokens 也计入 completion，正文可能为空，由 chat() 决定是否重试
    return {
      content: (choice?.message?.content || '').trim(),
      model,
      latencyMs: Date.now() - started,
      finishReason: choice?.finish_reason,
      usage: json.usage,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 调用对话补全。失败返回 null（调用方回退本地规则）。
 * 内置：429/5xx 重试一次；模型不存在时自动降级到 deepseek-chat。
 */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult | null> {
  if (!llmEnabled()) return null;

  const model = llmModel();
  try {
    const first = await callOnce(messages, model, opts);
    if (first.content) return first;

    // 正文为空：多半是思考 token 把预算吃满（finish_reason=length）
    console.warn(`[llm] 正文为空（finish=${first.finishReason ?? 'unknown'}，thinking 已占用 completion 预算），关闭思考模式重试`);
    const retry = await callOnce(messages, model, {
      ...opts,
      thinking: false,
      maxTokens: Math.min(8000, Math.max(2048, (opts.maxTokens ?? 2048) * 2)),
    });
    if (retry.content) return retry;
    console.warn('[llm] 重试后正文仍为空');
    return null;
  } catch (e1) {
    const err1 = e1 as Error & { status?: number };
    if (err1.name === 'AbortError') {
      console.warn('[llm] DeepSeek 调用超时');
      return null;
    }
    // 模型名不被支持 → 降级一次
    const modelMissing = err1.status === 404 || /model.*(not|does not)|invalid.*model|unsupported/i.test(err1.message);
    if (modelMissing && model !== FALLBACK_MODEL) {
      console.warn(`[llm] 模型 ${model} 不可用，降级到 ${FALLBACK_MODEL}`);
      resolvedModel = FALLBACK_MODEL;
      try {
        return await callOnce(messages, FALLBACK_MODEL, opts);
      } catch (e2) {
        console.warn('[llm] 降级模型仍失败:', sanitize((e2 as Error).message));
        return null;
      }
    }
    // 限流 / 服务端错误 → 退避重试一次
    if (err1.status === 429 || (err1.status && err1.status >= 500)) {
      await new Promise((r) => setTimeout(r, 800));
      try {
        return await callOnce(messages, model, opts);
      } catch (e3) {
        console.warn('[llm] 重试失败:', sanitize((e3 as Error).message));
        return null;
      }
    }
    console.warn('[llm] 调用失败:', sanitize(err1.message));
    return null;
  }
}

/** 纯文本补全，失败返回 null */
export async function chatText(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string | null> {
  const r = await chat(messages, opts);
  return r ? r.content.trim() : null;
}

/** 从模型输出中稳健地抽取 JSON（容忍 ```json 围栏与前后解释文字） */
export function extractJson<T>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  const slice = text.slice(first, last + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {
    // 常见问题：尾逗号
    try {
      return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')) as T;
    } catch {
      return null;
    }
  }
}

/** 要求模型输出 JSON 对象；解析失败返回 null */
export async function chatJson<T>(messages: ChatMessage[], opts: ChatOptions = {}): Promise<{ data: T; meta: ChatResult } | null> {
  const r = await chat(messages, { ...opts, json: true });
  if (!r) return null;
  const data = extractJson<T>(r.content);
  return data ? { data, meta: r } : null;
}
