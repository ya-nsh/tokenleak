import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { DateRange } from '@tokenleak/core';
import { AntigravityProvider } from './antigravity';
import { AmpProvider } from './amp';
import { CodebuffProvider } from './codebuff';
import { CopilotProvider } from './copilot';
import { CrushProvider } from './crush';
import { DroidProvider } from './droid';
import { GeminiProvider } from './gemini';
import { GooseProvider } from './goose';
import { HermesProvider } from './hermes';
import { KiloProvider } from './kilo';
import { KimiProvider } from './kimi';
import { KiroProvider } from './kiro';
import { KiloCodeProvider, RooCodeProvider } from './roo-kilo-code';
import { MuxProvider } from './mux';
import { OpenClawProvider } from './openclaw';
import { QwenProvider } from './qwen';
import { SyntheticProvider } from './synthetic';
import { TraeProvider } from './trae';
import { ZedProvider } from './zed';

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

  it('loads Hermes SQLite rows when optional cost columns are absent', async () => {
    const root = tempDir('hermes-minimal');
    const dbPath = join(root, 'state.db');
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE sessions (
        id TEXT,
        model TEXT,
        started_at REAL,
        input_tokens INTEGER,
        output_tokens INTEGER
      )
    `);
    db.run(`
      INSERT INTO sessions VALUES (
        'hermes-minimal-session',
        'claude-sonnet-4',
        1770724800,
        10,
        3
      )
    `);
    db.close();

    const data = await new HermesProvider(dbPath).load(RANGE);

    expect(data.provider).toBe('hermes');
    expect(data.totalTokens).toBe(13);
    expect(data.events?.[0]?.sessionId).toBe('hermes-minimal-session');
  });

  it('preserves Hermes provider-reported cost when token columns are absent', async () => {
    const root = tempDir('hermes-cost-only');
    const dbPath = join(root, 'state.db');
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE sessions (
        id TEXT,
        model TEXT,
        started_at REAL,
        actual_cost_usd REAL
      )
    `);
    db.run(`
      INSERT INTO sessions VALUES (
        'hermes-cost-only-session',
        'claude-sonnet-4',
        1770724800,
        1.25
      )
    `);
    db.close();

    const data = await new HermesProvider(dbPath).load(RANGE);

    expect(data.provider).toBe('hermes');
    expect(data.totalTokens).toBe(0);
    expect(data.totalCost).toBe(1.25);
    expect(data.events?.[0]?.sessionId).toBe('hermes-cost-only-session');
  });

  it('loads Codebuff chat message usage from project chat files', async () => {
    const root = tempDir('codebuff');
    const chatDir = join(root, 'projects', 'repo-a', 'chats', '2026-02-10T12-00-00.000Z');
    mkdirSync(chatDir, { recursive: true });
    writeFileSync(join(chatDir, 'chat-messages.json'), JSON.stringify([
      { variant: 'user', text: 'hello' },
      {
        id: 'assistant-1',
        variant: 'assistant',
        timestamp: '2026-02-10T12:00:00.000Z',
        metadata: {
          usage: {
            model: 'claude-sonnet-4',
            inputTokens: 11,
            outputTokens: 7,
            cacheReadInputTokens: 5,
            cacheCreationInputTokens: 2,
            credits: 0.04,
          },
        },
      },
    ]));

    const data = await new CodebuffProvider(root).load(RANGE);

    expect(data.provider).toBe('codebuff');
    expect(data.totalTokens).toBe(25);
    expect(data.totalCost).toBe(0.04);
    expect(data.events?.[0]?.projectId).toBe('repo-a');
    expect(data.events?.[0]?.sessionId).toContain('2026-02-10T12-00-00.000Z');
  });

  it('loads Droid settings token usage and JSONL model fallback', async () => {
    const root = tempDir('droid');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'session-a.settings.json'), JSON.stringify({
      providerLock: 'anthropic',
      providerLockTimestamp: '2026-02-10T12:00:00.000Z',
      tokenUsage: {
        inputTokens: 20,
        outputTokens: 6,
        cacheReadTokens: 4,
        cacheCreationTokens: 3,
        thinkingTokens: 2,
      },
    }));
    writeFileSync(join(root, 'session-a.jsonl'), JSON.stringify({
      type: 'system-reminder',
      text: 'Model: Claude Sonnet 4 [Anthropic]',
    }));

    const data = await new DroidProvider(root).load(RANGE);

    expect(data.provider).toBe('droid');
    expect(data.totalTokens).toBe(35);
    expect(data.daily[0]!.models[0]!.model).toBe('claude-sonnet-4');
    expect(data.daily[0]!.outputTokens).toBe(8);
  });

  it('loads Kimi wire protocol StatusUpdate usage', async () => {
    const root = tempDir('kimi');
    const sessionDir = join(root, 'sessions', 'group-a', 'session-a');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(root, 'config.json'), JSON.stringify({ model: 'kimi-k2' }));
    writeFileSync(join(sessionDir, 'wire.jsonl'), [
      JSON.stringify({ type: 'metadata' }),
      JSON.stringify({
        timestamp: 1770724800,
        message: {
          type: 'StatusUpdate',
          payload: {
            message_id: 'msg-1',
            token_usage: {
              input_other: 30,
              output: 9,
              input_cache_read: 6,
              input_cache_creation: 3,
            },
          },
        },
      }),
    ].join('\n'));

    const data = await new KimiProvider(root).load(RANGE);

    expect(data.provider).toBe('kimi');
    expect(data.totalTokens).toBe(48);
    expect(data.events?.[0]?.sessionId).toBe('session-a');
  });

  it('loads Kilo CLI SQLite usage rows', async () => {
    const root = tempDir('kilo');
    const dbPath = join(root, 'kilo.db');
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE usage (
        id TEXT,
        session_id TEXT,
        model TEXT,
        provider TEXT,
        timestamp INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        cost REAL
      )
    `);
    db.run(`
      INSERT INTO usage VALUES (
        'usage-1',
        'kilo-session',
        'gpt-5',
        'openai',
        1770724800000,
        14,
        5,
        4,
        2,
        0.06
      )
    `);
    db.close();

    const data = await new KiloProvider(dbPath).load(RANGE);

    expect(data.provider).toBe('kilo');
    expect(data.totalTokens).toBe(25);
    expect(data.totalCost).toBe(0.06);
    expect(data.events?.[0]?.sessionId).toBe('kilo-session');
  });

  it('loads Mux session usage JSON by model', async () => {
    const root = tempDir('mux');
    const sessionDir = join(root, 'sessions', 'workspace-a');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session-usage.json'), JSON.stringify({
      byModel: {
        'anthropic:claude-sonnet-4': {
          input: { tokens: 10, cost_usd: 0.01 },
          output: { tokens: 4, cost_usd: 0.02 },
          cached: { tokens: 3, cost_usd: 0.001 },
          cacheCreate: { tokens: 2, cost_usd: 0.002 },
          reasoning: { tokens: 1, cost_usd: 0.003 },
        },
      },
      lastRequest: { timestamp: 1770724800000 },
    }));

    const data = await new MuxProvider(root).load(RANGE);

    expect(data.provider).toBe('mux');
    expect(data.totalTokens).toBe(20);
    expect(data.totalCost).toBe(0.036);
    expect(data.events?.[0]?.projectId).toBe('workspace-a');
  });

  it('loads Crush root session costs without fabricating tokens', async () => {
    const dbPath = join(tempDir('crush'), 'crush.db');
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE sessions (
        id TEXT,
        parent_session_id TEXT,
        cost REAL,
        created_at INTEGER,
        updated_at INTEGER,
        message_count INTEGER
      )
    `);
    db.run(`
      CREATE TABLE messages (
        session_id TEXT,
        role TEXT,
        created_at INTEGER
      )
    `);
    db.run("INSERT INTO sessions VALUES ('root', NULL, 0.5, 1770724800, 1770724900, 2)");
    db.run("INSERT INTO messages VALUES ('root', 'assistant', 1770724800)");
    db.close();

    const data = await new CrushProvider([dbPath]).load(RANGE);

    expect(data.provider).toBe('crush');
    expect(data.totalTokens).toBe(0);
    expect(data.totalCost).toBe(0.5);
    expect(data.events?.[0]?.model).toBe('session-total');
  });

  it('loads Goose SQLite session totals', async () => {
    const dbPath = join(tempDir('goose'), 'sessions.db');
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE sessions (
        id TEXT,
        model_config_json TEXT,
        provider_name TEXT,
        created_at TEXT,
        total_tokens INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        accumulated_total_tokens INTEGER,
        accumulated_input_tokens INTEGER,
        accumulated_output_tokens INTEGER
      )
    `);
    db.run(`
      INSERT INTO sessions VALUES (
        'goose-session',
        '{"model_name":"claude-sonnet-4"}',
        'anthropic',
        '2026-02-10T12:00:00.000Z',
        25,
        10,
        5,
        30,
        12,
        7
      )
    `);
    db.close();

    const data = await new GooseProvider(dbPath).load(RANGE);

    expect(data.provider).toBe('goose');
    expect(data.totalTokens).toBe(30);
    expect(data.daily[0]!.outputTokens).toBe(18);
    expect(data.events?.[0]?.sessionId).toBe('goose-session');
  });

  it('loads cached Antigravity JSONL usage rows', async () => {
    const root = tempDir('antigravity');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'session.jsonl'), [
      JSON.stringify({ type: 'session_meta', sessionId: 'ag-session', modelId: 'claude-sonnet-4' }),
      JSON.stringify({
        type: 'usage',
        sessionId: 'ag-session',
        timestamp: 1770724800000,
        input: 22,
        output: 8,
        cacheRead: 4,
        cacheWrite: 2,
        reasoning: 1,
        responseId: 'resp-1',
      }),
    ].join('\n'));

    const data = await new AntigravityProvider(root).load(RANGE);

    expect(data.provider).toBe('antigravity');
    expect(data.totalTokens).toBe(37);
    expect(data.events?.[0]?.sessionId).toBe('ag-session');
  });

  it('loads hosted Zed Agent threads and ignores external providers', async () => {
    const dbPath = join(tempDir('zed'), 'threads.db');
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE threads (
        id TEXT,
        updated_at TEXT,
        folder_paths TEXT,
        folder_paths_order TEXT,
        data_type TEXT,
        data BLOB
      )
    `);
    const hosted = JSON.stringify({
      model: { provider: 'zed.dev', model: 'claude-sonnet-4' },
      usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 2, cache_write_tokens: 1 },
    });
    const external = JSON.stringify({
      model: { provider: 'anthropic', model: 'claude-sonnet-4' },
      usage: { input_tokens: 999, output_tokens: 999 },
    });
    db.run('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)', [
      'zed-hosted',
      '2026-02-10T12:00:00.000Z',
      JSON.stringify(['/repo/zed']),
      JSON.stringify([0]),
      'json',
      Buffer.from(hosted),
    ]);
    db.run('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)', [
      'zed-external',
      '2026-02-10T12:00:00.000Z',
      null,
      null,
      'json',
      Buffer.from(external),
    ]);
    db.close();

    const data = await new ZedProvider(dbPath).load(RANGE);

    expect(data.provider).toBe('zed');
    expect(data.totalTokens).toBe(18);
    expect(data.events?.[0]?.projectId).toBe('zed');
  });

  it('loads Zed threads when TOKENLEAK_ZED_DIR points at the data directory', async () => {
    const previousEnv = process.env;
    const root = tempDir('zed-env-dir');
    const threadsDir = join(root, 'threads');
    mkdirSync(threadsDir, { recursive: true });
    const dbPath = join(threadsDir, 'threads.db');
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE threads (
        id TEXT,
        updated_at TEXT,
        folder_paths TEXT,
        folder_paths_order TEXT,
        data_type TEXT,
        data BLOB
      )
    `);
    db.run('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)', [
      'zed-env-hosted',
      '2026-02-10T12:00:00.000Z',
      JSON.stringify(['/repo/zed-env']),
      JSON.stringify([0]),
      'json',
      Buffer.from(JSON.stringify({
        model: { provider: 'zed.dev', model: 'claude-sonnet-4' },
        usage: { input_tokens: 5, output_tokens: 4 },
      })),
    ]);
    db.close();

    try {
      process.env = { ...process.env, TOKENLEAK_ZED_DIR: root };
      const provider = new ZedProvider();
      const data = await provider.load(RANGE);

      expect(await provider.isAvailable()).toBe(true);
      expect(data.provider).toBe('zed');
      expect(data.totalTokens).toBe(9);
      expect(data.events?.[0]?.sessionId).toBe('zed-env-hosted');
    } finally {
      process.env = previousEnv;
    }
  });

  it('loads Kiro CLI file sessions with explicit turn token counts', async () => {
    const root = tempDir('kiro');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'session.json'), JSON.stringify({
      session_id: 'kiro-session',
      cwd: '/repo/kiro',
      session_state: {
        rts_model_state: {
          model_info: { model_id: 'claude-sonnet-4', context_window_tokens: 200000 },
        },
        conversation_metadata: {
          user_turn_metadatas: [
            {
              input_token_count: 44,
              output_token_count: 11,
              end_timestamp: 1770724800000,
              total_request_count: 1,
            },
          ],
        },
      },
    }));

    const data = await new KiroProvider(root).load(RANGE);

    expect(data.provider).toBe('kiro');
    expect(data.totalTokens).toBe(55);
    expect(data.events?.[0]?.projectId).toBe('kiro');
  });

  it('loads cached Trae usage API JSON', async () => {
    const root = tempDir('trae');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'usage.json'), JSON.stringify([
      {
        model_name: 'GPT-5.4',
        session_id: 'trae-session',
        usage_time: 1770724800,
        dollar_float: 0.09,
        extra_info: {
          input_token: 21,
          output_token: 8,
          cache_read_token: 4,
          cache_write_token: 2,
        },
      },
    ]));

    const data = await new TraeProvider(root).load(RANGE);

    expect(data.provider).toBe('trae');
    expect(data.totalTokens).toBe(35);
    expect(data.totalCost).toBe(0.09);
    expect(data.daily[0]!.models[0]!.model).toBe('gpt-5.4');
  });

  it('loads Synthetic Octofriend SQLite token rows', async () => {
    const dbPath = join(tempDir('synthetic'), 'sqlite.db');
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE messages (
        id TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        reasoning_tokens INTEGER,
        cost REAL,
        timestamp INTEGER,
        session_id TEXT,
        provider TEXT
      )
    `);
    db.run(`
      INSERT INTO messages VALUES (
        'synthetic-message',
        'hf:deepseek-ai/DeepSeek-V3-0324',
        13,
        7,
        3,
        1,
        2,
        0.04,
        1770724800000,
        'synthetic-session',
        'synthetic'
      )
    `);
    db.close();

    const data = await new SyntheticProvider(dbPath).load(RANGE);

    expect(data.provider).toBe('synthetic');
    expect(data.totalTokens).toBe(26);
    expect(data.totalCost).toBe(0.04);
    expect(data.daily[0]!.models[0]!.model).toBe('deepseek-v3-0324');
  });
});
