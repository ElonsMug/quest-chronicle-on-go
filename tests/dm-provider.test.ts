import assert from "node:assert/strict";
import test from "node:test";
import { DmProviderError, generateDmReply, getDmConfig } from "../src/lib/dm-provider.server.ts";

const request = {
  purpose: "turn" as const,
  system: "Игровые правила",
  messages: [
    { role: "assistant" as const, content: "Вы у ворот." },
    { role: "user" as const, content: "Проверяю замок." },
    { role: "user" as const, content: "Действую тихо." },
  ],
};
const reply = "Слышен щелчок. [ROLL: DEX, DC=12]";

test("Gemini receives the system instruction and turns, and returns visible text", async (t) => {
  const config = getDmConfig({ DM_PROVIDER: "gemini", GEMINI_API_KEY: "test-key" });
  assert.ok(config);
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ thought: true, text: "internal" }, { text: reply }] },
        },
      ],
      usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 100, thoughtsTokenCount: 20 },
    }),
  );
  const log = t.mock.method(console, "info", () => {});
  assert.equal(await generateDmReply(config, request), reply);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.match(url, /gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(options.headers["x-goog-api-key"], "test-key");
  const body = JSON.parse(options.body);
  assert.deepEqual(body.systemInstruction.parts, [{ text: request.system }]);
  assert.deepEqual(body.contents, [
    { role: "user", parts: [{ text: "Begin the adventure." }] },
    { role: "model", parts: [{ text: request.messages[0].content }] },
    { role: "user", parts: request.messages.slice(1).map(({ content }) => ({ text: content })) },
  ]);
  assert.equal(log.mock.calls[0].arguments[1].output, 120);
});

test("DeepSeek sends the same turns and surfaces rate limiting or incomplete output", async (t) => {
  const config = getDmConfig({ DM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test-key" });
  assert.ok(config);
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      choices: [{ finish_reason: "stop", message: { content: reply } }],
      usage: { prompt_tokens: 1000, completion_tokens: 180, prompt_cache_hit_tokens: 700 },
    }),
  );
  const log = t.mock.method(console, "info", () => {});
  assert.equal(await generateDmReply(config, request), reply);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, "https://api.deepseek.com/chat/completions");
  assert.equal(options.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(options.body);
  assert.equal(body.model, "deepseek-flash");
  assert.deepEqual(body.messages, [
    { role: "system", content: request.system },
    ...request.messages,
  ]);
  assert.equal(log.mock.calls[0].arguments[1].cachedInput, 700);

  fetch.mock.mockImplementationOnce(async () => new Response("", { status: 429 }));
  await assert.rejects(
    generateDmReply(config, request),
    (error) => error instanceof DmProviderError && error.status === 429,
  );

  fetch.mock.mockImplementationOnce(async () =>
    Response.json({
      choices: [{ finish_reason: "length", message: { content: "[ROLL:" } }],
    }),
  );
  await assert.rejects(generateDmReply(config, request), DmProviderError);
});

test("provider selection requires the matching server key", () => {
  assert.equal(getDmConfig({ DM_PROVIDER: "gemini", DEEPSEEK_API_KEY: "test-key" }), null);
  assert.equal(getDmConfig({ DM_PROVIDER: "unknown" }), null);
  assert.equal(getDmConfig({ ANTHROPIC_API_KEY: "test-key" })?.provider, "anthropic");
});
