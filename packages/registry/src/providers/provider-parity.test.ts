import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { DateRange } from '@tokenleak/core';
import { AmpProvider } from './amp';
import { CopilotProvider } from './copilot';
import { GeminiProvider } from './gemini';
import { HermesProvider } from './hermes';
import { KiloCodeProvider, RooCodeProvider } from './roo-kilo-code';
import { OpenClawProvider } from './openclaw';
import { QwenProvider } from './qwen';

const RANGE: DateRange = { since: '2026-02-01', until: '2026-02-28' };

function tempDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `tokenleak-${name}-`));
}

describe('provider parity providers', () => {
  it('loads Gemini session JSON without subtracting cache-exclusive input', async () => {
    const root = tempDir('gemini');
    const sessionDir = join(root, 'abc', 'chats');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'chat.json'), JSON.stringify({
      sessionId: 'gemini-session',
      messages: [
        {
          message_type: 'gemini',
          timestamp: '2026-02-10T12:00:00.000Z',
          model: 'gemini-2.5-pro',
          tokens: { input: 120, output: 30, cached: 20, thoughts: 5, total: 175 },
        },
      ],
    }));

    const data = await new GeminiProvider(root).load(RANGE);

    expect(data.provider).toBe('gemini');
    expect(data.daily).toHaveLength(1);
    expect(data.daily[0]!.inputTokens).toBe(120);
    expect(data.daily[0]!.cacheReadTokens).toBe(20);
    expect(data.daily[0]!.outputTokens).toBe(35);
    expect(data.daily[0]!.totalTokens).toBe(175);
    expect(data.events?.[0]?.sessionId).toBe('gemini-session');
  });

  it('splits Gemini session cached input when total shows inclusive input', async () => {
    const root = tempDir('gemini-inclusive');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'chat.json'), JSON.stringify({
      sessionId: 'gemini-inclusive-session',
      messages: [
        {
          message_type: 'gemini',
          timestamp: '2026-02-10T12:00:00.000Z',
          model: 'gemini-2.5-pro',
          tokens: { input: 120, output: 30, cached: 20, thoughts: 5, total: 155 },
        },
      ],
    }));

    const data = await new GeminiProvider(root).load(RANGE);

    expect(data.daily[0]!.inputTokens).toBe(100);
    expect(data.daily[0]!.cacheReadTokens).toBe(20);
    expect(data.daily[0]!.outputTokens).toBe(35);
    expect(data.daily[0]!.totalTokens).toBe(155);
  });

  it('loads Gemini headless stats token fields', async () => {
    const root = tempDir('gemini-stats');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'stats.json'), JSON.stringify({
      model: 'gemini-2.5-pro',
      timestamp: '2026-02-10T12:00:00.000Z',
      stats: {
        input_tokens: 100,
        output_tokens: 20,
        cached_tokens: 5,
        thoughts_tokens: 3,
      },
    }));

    const data = await new GeminiProvider(root).load(RANGE);

    expect(data.provider).toBe('gemini');
    expect(data.totalTokens).toBe(123);
    expect(data.daily[0]!.inputTokens).toBe(95);
    expect(data.daily[0]!.outputTokens).toBe(23);
    expect(data.daily[0]!.cacheReadTokens).toBe(5);
  });

  it('loads Copilot OTEL chat spans and ignores non-chat spans', async () => {
    const root = tempDir('copilot');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'otel.jsonl'), [
      JSON.stringify({
        type: 'span',
        traceId: 'trace-1',
        spanId: 'tool-1',
        name: 'execute_tool rg',
        attributes: { 'gen_ai.operation.name': 'execute_tool' },
      }),
      JSON.stringify({
        type: 'span',
        traceId: 'trace-1',
        spanId: 'chat-1',
        name: 'chat gpt-5.4-mini',
        endTime: [1770724800, 0],
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.response.model': 'gpt-5.4-mini',
          'gen_ai.conversation.id': 'conversation-1',
          'gen_ai.usage.input_tokens': 100,
          'gen_ai.usage.output_tokens': 10,
          'gen_ai.usage.cache_read.input_tokens': 25,
          'gen_ai.usage.cache_write.input_tokens': 5,
        },
      }),
    ].join('\n'));

    const data = await new CopilotProvider(root).load(RANGE);

    expect(data.provider).toBe('copilot');
    expect(data.daily).toHaveLength(1);
    expect(data.daily[0]!.inputTokens).toBe(75);
    expect(data.daily[0]!.outputTokens).toBe(10);
    expect(data.daily[0]!.cacheReadTokens).toBe(25);
    expect(data.daily[0]!.cacheWriteTokens).toBe(5);
    expect(data.events?.[0]?.sessionId).toBe('conversation-1');
  });

  it('loads Amp usage ledger records and message usage without double counting matches', async () => {
    const root = tempDir('amp');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'T-thread.json'), JSON.stringify({
      id: 'amp-thread',
      created: 1770724800000,
      usageLedger: {
        events: [
          {
            timestamp: '2026-02-10T12:00:00.000Z',
            model: 'claude-sonnet-4',
            credits: 0.02,
            toMessageId: 1,
            tokens: {
              input: 100,
              output: 20,
              cacheReadInputTokens: 10,
              cacheCreationInputTokens: 5,
            },
          },
        ],
      },
      messages: [
        {
          role: 'assistant',
          messageId: 1,
          usage: {
            model: 'claude-sonnet-4',
            inputTokens: 100,
            outputTokens: 20,
            cacheReadInputTokens: 10,
            cacheCreationInputTokens: 5,
            credits: 0.01,
          },
        },
      ],
    }));

    const data = await new AmpProvider(root).load(RANGE);

    expect(data.provider).toBe('amp');
    expect(data.daily).toHaveLength(1);
    expect(data.totalTokens).toBe(135);
    expect(data.totalCost).toBe(0.02);
    expect(data.costCompleteness).toMatchObject({
      pricedTokens: 135,
      unpricedTokens: 0,
    });
    expect(data.events?.[0]?.costSource).toBe('provider-reported');
  });

  it('uses file mtime for Amp message usage when thread created is missing', async () => {
    const root = tempDir('amp-message-only');
    mkdirSync(root, { recursive: true });
    const file = join(root, 'T-no-created.json');
    writeFileSync(file, JSON.stringify({
      id: 'amp-message-only',
      messages: [
        {
          role: 'assistant',
          messageId: 1,
          usage: {
            model: 'claude-sonnet-4',
            inputTokens: 10,
            outputTokens: 2,
          },
        },
      ],
    }));
    const mtime = new Date('2026-02-10T12:00:00.000Z');
    utimesSync(file, mtime, mtime);

    const data = await new AmpProvider(root).load(RANGE);

    expect(data.provider).toBe('amp');
    expect(data.daily).toHaveLength(1);
    expect(data.totalTokens).toBe(12);
    expect(data.events?.[0]?.date).toBe('2026-02-10');
  });

  it('loads Qwen assistant usage metadata', async () => {
    const root = tempDir('qwen');
    const chatDir = join(root, 'project-a', 'chats');
    mkdirSync(chatDir, { recursive: true });
    writeFileSync(join(chatDir, 'session.jsonl'), [
      JSON.stringify({ type: 'user', timestamp: '2026-02-10T11:59:00.000Z', content: 'hello' }),
      JSON.stringify({
        type: 'assistant',
        model: 'qwen3.5-plus',
        timestamp: '2026-02-10T12:00:00.000Z',
        sessionId: 'qwen-session',
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 3,
          cachedContentTokenCount: 7,
        },
      }),
    ].join('\n'));

    const data = await new QwenProvider(root).load(RANGE);

    expect(data.provider).toBe('qwen');
    expect(data.daily[0]!.inputTokens).toBe(100);
    expect(data.daily[0]!.outputTokens).toBe(23);
    expect(data.daily[0]!.cacheReadTokens).toBe(7);
    expect(data.events?.[0]?.projectId).toBe('project-a');
  });

  it('loads Roo Code and Kilo Code ui_messages task logs', async () => {
    const rooRoot = tempDir('roo');
    const kiloRoot = tempDir('kilo-code');
    for (const root of [rooRoot, kiloRoot]) {
      const taskDir = join(root, 'task-abc');
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(join(taskDir, 'api_conversation_history.json'), [
        '<environment_details>',
        '<model>gpt-5</model>',
        '<slug>architect</slug>',
        '</environment_details>',
      ].join('\n'));
      writeFileSync(join(taskDir, 'ui_messages.json'), JSON.stringify([
        {
          type: 'say',
          say: 'api_req_started',
          ts: '2026-02-10T12:00:00.000Z',
          text: JSON.stringify({
            cost: 0.05,
            tokensIn: 40,
            tokensOut: 15,
            cacheReads: 7,
            cacheWrites: 3,
          }),
        },
      ]));
    }

    const roo = await new RooCodeProvider(rooRoot).load(RANGE);
    const kilo = await new KiloCodeProvider(kiloRoot).load(RANGE);

    expect(roo.provider).toBe('roo-code');
    expect(kilo.provider).toBe('kilo-code');
    expect(roo.totalTokens).toBe(65);
    expect(kilo.totalCost).toBe(0.05);
    expect(roo.events?.[0]?.projectId).toBe('architect');
  });

  it('loads OpenClaw transcript usage after model changes', async () => {
    const root = tempDir('openclaw');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'session.jsonl'), [
      JSON.stringify({ type: 'model_change', provider: 'openai-codex', modelId: 'gpt-5.2' }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          timestamp: 1770724800000,
          usage: {
            input: 10,
            output: 5,
            cacheRead: 2,
            cacheWrite: 1,
            cost: { total: 0.03 },
          },
        },
      }),
    ].join('\n'));

    const data = await new OpenClawProvider(root).load(RANGE);

    expect(data.provider).toBe('openclaw');
    expect(data.totalTokens).toBe(18);
    expect(data.totalCost).toBe(0.03);
    expect(data.daily[0]!.models[0]!.model).toBe('gpt-5.2');
  });

  it('loads Hermes SQLite session rows', async () => {
    const root = tempDir('hermes');
    const dbPath = join(root, 'state.db');
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE sessions (
        id TEXT,
        model TEXT,
        billing_provider TEXT,
        started_at REAL,
        message_count INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        reasoning_tokens INTEGER,
        estimated_cost_usd REAL,
        actual_cost_usd REAL
      )
    `);
    db.run(`
      INSERT INTO sessions VALUES (
        'hermes-session',
        'claude-sonnet-4',
        'anthropic',
        1770724800,
        3,
        100,
        20,
        10,
        5,
        2,
        0.07,
        0.08
      )
    `);
    db.close();

    const data = await new HermesProvider(dbPath).load(RANGE);

    expect(data.provider).toBe('hermes');
    expect(data.totalTokens).toBe(137);
    expect(data.totalCost).toBe(0.08);
    expect(data.events?.[0]?.projectId).toBe('anthropic');
  });
});
