import { z } from "zod";

// LLM 呼び出しの共通部品（common.md 2.4）。OpenAI の Chat Completions を fetch で呼ぶ（SDK は入れない。17.1 #12）。
// ログに出すのは name・所要時間・成否・エラーの種類だけ。入力・出力の文章と APIキーは出さない

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export type LlmErrorKind =
  | "disabled" // LLM_MODE=off・キーやモデルがない
  | "timeout"
  | "network"
  | "http" // HTTP ステータスが 2xx でない
  | "refusal" // モデルが応答を拒否した
  | "invalid_json" // 応答が JSON でない・本文がない
  | "invalid_shape"; // JSON がスキーマに合わない

export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    message: string = kind,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

const envValue = (key: string) => process.env[key]?.trim() ?? "";

// LLM_MODE=on で、OPENAI_API_KEY と OPENAI_MODEL がどちらも空でないとき（common.md 1.4）
export function isLlmEnabled(): boolean {
  return envValue("LLM_MODE") === "on" && envValue("OPENAI_API_KEY") !== "" && envValue("OPENAI_MODEL") !== "";
}

type JsonObject = { [key: string]: unknown };

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isObjectType = (type: unknown) =>
  type === "object" || (Array.isArray(type) && type.includes("object"));

// 入れ子のスキーマを持つキー（properties・$defs は「名前 → スキーマ」、anyOf などは配列、items は1つか配列）
const SCHEMA_MAPS = ["properties", "$defs", "definitions"];
const SCHEMA_LISTS = ["anyOf", "oneOf", "allOf", "prefixItems"];
const SCHEMA_SINGLES = ["items", "not", "additionalItems"];

function strictNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictNode);
  if (!isObject(node)) return node;

  const out: JsonObject = { ...node };
  for (const key of SCHEMA_MAPS) {
    const map = out[key];
    if (isObject(map)) {
      out[key] = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, strictNode(v)]));
    }
  }
  for (const key of [...SCHEMA_LISTS, ...SCHEMA_SINGLES]) {
    if (key in out) out[key] = strictNode(out[key]);
  }
  if (isObjectType(out.type) || isObject(out.properties)) {
    const properties = isObject(out.properties) ? out.properties : {};
    out.properties = properties;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  return out;
}

// z.toJSONSchema() の結果の、すべてのオブジェクト（入れ子・配列の中も）に
// additionalProperties: false と全キーの required を付ける（OpenAI の strict モード用）。$schema は渡さない
export function toStrictJsonSchema(schema: z.ZodType): JsonObject {
  const json = z.toJSONSchema(schema) as JsonObject;
  delete json.$schema;
  return strictNode(json) as JsonObject;
}

export type CallStructuredOptions<T> = {
  name: string; // ログ用・JSON Schema の名前
  system: string;
  user: string;
  schema: z.ZodType<T>; // LLM に渡す形（型だけ。制約なし）
  timeoutMs: number;
  retries: 0 | 1;
  temperature: number;
};

async function callOnce<T>(options: CallStructuredOptions<T>, jsonSchema: JsonObject): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${envValue("OPENAI_API_KEY")}`,
        },
        body: JSON.stringify({
          model: envValue("OPENAI_MODEL"),
          temperature: options.temperature,
          messages: [
            { role: "system", content: options.system },
            { role: "user", content: options.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: options.name, strict: true, schema: jsonSchema },
          },
        }),
        signal: controller.signal,
      });
    } catch {
      throw new LlmError(controller.signal.aborted ? "timeout" : "network");
    }
    if (!response.ok) throw new LlmError("http", `http ${response.status}`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LlmError(controller.signal.aborted ? "timeout" : "invalid_json");
    }
    const message = (body as { choices?: { message?: { content?: unknown; refusal?: unknown } }[] })
      ?.choices?.[0]?.message;
    if (message?.refusal) throw new LlmError("refusal");
    if (typeof message?.content !== "string") throw new LlmError("invalid_json");

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      throw new LlmError("invalid_json");
    }
    const result = options.schema.safeParse(parsed);
    if (!result.success) throw new LlmError("invalid_shape");
    return result.data;
  } finally {
    clearTimeout(timer);
  }
}

// 構造化出力で LLM を呼ぶ。失敗・タイムアウト・HTTP エラー・形の違いはすべて LlmError を投げる。
// retries 回まで（合計 1 + retries 回）試す
export async function callStructured<T>(options: CallStructuredOptions<T>): Promise<T> {
  if (!isLlmEnabled()) throw new LlmError("disabled");
  const jsonSchema = toStrictJsonSchema(options.schema);

  let lastError: LlmError = new LlmError("network");
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    const startedAt = performance.now();
    try {
      const data = await callOnce(options, jsonSchema);
      console.info(`[llm] ${options.name} ${Math.round(performance.now() - startedAt)}ms ok=true`);
      return data;
    } catch (e) {
      lastError = e instanceof LlmError ? e : new LlmError("network");
      console.warn(
        `[llm] ${options.name} ${Math.round(performance.now() - startedAt)}ms ok=false kind=${lastError.kind} attempt=${attempt + 1}`,
      );
    }
  }
  throw lastError;
}
