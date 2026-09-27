import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ReplanIntentLlmSchema } from "@/lib/schemas";
import { callStructured, isLlmEnabled, LlmError, toStrictJsonSchema } from "@/lib/llm/client";

// fetch と環境変数はテストの中だけで差し替える（実際の OpenAI は呼ばない）

const Schema = z.object({ answer: z.string(), score: z.number().nullable() });

const options = {
  name: "test_call",
  system: "system",
  user: "user",
  schema: Schema,
  timeoutMs: 1000,
  retries: 0 as const,
  temperature: 0,
};

// Chat Completions の応答の形
function completion(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content, refusal: null } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function enableLlm() {
  vi.stubEnv("LLM_MODE", "on");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("OPENAI_MODEL", "test-model");
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("callStructured", () => {
  it("成功：応答の JSON をスキーマに通して返す。リクエストは json_schema・strict", async () => {
    enableLlm();
    const fetchMock = vi.fn().mockResolvedValue(completion(JSON.stringify({ answer: "ok", score: null })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callStructured(options)).resolves.toEqual({ answer: "ok", score: null });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("test-model");
    expect(body.temperature).toBe(0);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("test_call");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
  });

  it("HTTP 500 → LlmError", async () => {
    enableLlm();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));

    const error = await callStructured(options).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("http");
  });

  it("タイムアウト → LlmError", async () => {
    enableLlm();
    vi.useFakeTimers();
    // signal が abort されるまで返らない fetch
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = callStructured(options).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const error = await pending;
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("timeout");
  });

  it("形の違う JSON → LlmError", async () => {
    enableLlm();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion(JSON.stringify({ answer: 1 }))));

    const error = await callStructured(options).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("invalid_shape");
  });

  it("JSON でない本文 → LlmError", async () => {
    enableLlm();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion("not json")));

    const error = await callStructured(options).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("invalid_json");
  });

  it("retries: 1 で、1回目が失敗・2回目が成功 → 2回目の結果", async () => {
    enableLlm();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockResolvedValueOnce(completion(JSON.stringify({ answer: "second", score: 1 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callStructured({ ...options, retries: 1 })).resolves.toEqual({ answer: "second", score: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("LLM が無効なら fetch を呼ばずに LlmError", async () => {
    vi.stubEnv("LLM_MODE", "off");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await callStructured(options).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ログに入力・出力の文章と APIキーを出さない", async () => {
    enableLlm();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(completion(JSON.stringify({ answer: "秘密の答え", score: null }))),
    );
    await callStructured({ ...options, system: "秘密のシステム", user: "秘密の発言" });

    const logged = JSON.stringify([
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
    ]);
    for (const secret of ["秘密のシステム", "秘密の発言", "秘密の答え", "sk-test"]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe("toStrictJsonSchema", () => {
  it("入れ子・配列の中・nullable のオブジェクトにも additionalProperties: false と全キーの required を付ける", () => {
    const schema = z.object({
      a: z.string(),
      nested: z.object({ b: z.number(), c: z.string().optional() }),
      list: z.array(z.object({ d: z.boolean(), e: z.string().nullable() })),
      maybe: z.object({ f: z.string() }).nullable(),
    });
    const json = toStrictJsonSchema(schema) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe("object");
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(["a", "nested", "list", "maybe"]);

    expect(json.properties.nested.additionalProperties).toBe(false);
    expect(json.properties.nested.required).toEqual(["b", "c"]);

    expect(json.properties.list.items.additionalProperties).toBe(false);
    expect(json.properties.list.items.required).toEqual(["d", "e"]);

    const maybeObject = json.properties.maybe.anyOf.find((s: { type: string }) => s.type === "object");
    expect(maybeObject.additionalProperties).toBe(false);
    expect(maybeObject.required).toEqual(["f"]);
  });

  it("ReplanIntentLlmSchema：一番外は type: object、optional な欄はなく、null になりうる欄は null を許す", () => {
    const json = toStrictJsonSchema(ReplanIntentLlmSchema);
    expect(json.type).toBe("object");
    expect(json.anyOf).toBeUndefined();
    expect(json).toMatchInlineSnapshot(`
      {
        "additionalProperties": false,
        "properties": {
          "fatigue": {
            "anyOf": [
              {
                "enum": [
                  "low",
                  "medium",
                  "high",
                ],
                "type": "string",
              },
              {
                "type": "null",
              },
            ],
          },
          "new_fixed_events": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "end_time": {
                  "type": [
                    "string",
                    "null",
                  ],
                },
                "start_time": {
                  "type": "string",
                },
                "title": {
                  "type": [
                    "string",
                    "null",
                  ],
                },
              },
              "required": [
                "title",
                "start_time",
                "end_time",
              ],
              "type": "object",
            },
            "type": "array",
          },
          "preference_changes": {
            "items": {
              "type": "string",
            },
            "type": "array",
          },
          "task_changes": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "action": {
                  "enum": [
                    "postpone",
                    "skip",
                    "shorten",
                  ],
                  "type": "string",
                },
                "task_id": {
                  "type": "string",
                },
              },
              "required": [
                "task_id",
                "action",
              ],
              "type": "object",
            },
            "type": "array",
          },
          "type": {
            "enum": [
              "state_change",
              "task_change",
              "new_fixed_event",
              "preference_change",
              "unknown",
            ],
            "type": "string",
          },
        },
        "required": [
          "type",
          "fatigue",
          "task_changes",
          "new_fixed_events",
          "preference_changes",
        ],
        "type": "object",
      }
    `);
  });
});

describe("isLlmEnabled", () => {
  it("LLM_MODE=on・キー・モデルがそろえば true", () => {
    enableLlm();
    expect(isLlmEnabled()).toBe(true);
  });

  it("LLM_MODE=off → false", () => {
    enableLlm();
    vi.stubEnv("LLM_MODE", "off");
    expect(isLlmEnabled()).toBe(false);
  });

  it("キーがない → false", () => {
    enableLlm();
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(isLlmEnabled()).toBe(false);
  });

  it("モデルがない → false", () => {
    enableLlm();
    vi.stubEnv("OPENAI_MODEL", "  ");
    expect(isLlmEnabled()).toBe(false);
  });
});
