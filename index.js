'use strict';

// ============================================================================
// index.js — Cron MCP Server entry point (stdio transport)
//
// Lets AI coding agents (Claude, Cursor, Copilot, Cline) parse, validate,
// explain, and preview cron expressions as MCP tools.
//
// Engine reused from the battle-tested vscode-cron lib (638 lines, 69 tests).
// Zero-dependency engine; only depends on @modelcontextprotocol/sdk + zod
// for the MCP transport/schema layer.
// ============================================================================

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const cron = require('./lib/cron');

const SERVER_NAME = 'cron-mcp-server';
const SERVER_VERSION = require('./package.json').version;

// ---- Tool definitions ----

const TOOLS = [
  {
    name: 'parse_cron',
    description:
      'Parse a cron expression and return a human-readable description of when it fires. ' +
      'Supports 5-field standard cron (min hour dom month dow) plus extensions: L (last day/weekday), ' +
      'W (nearest weekday), # (nth weekday), and named months/days (JAN..DEC, SUN..SAT). ' +
      'Use this to explain any cron schedule in plain English.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The cron expression to parse, e.g. "*/5 * * * *" or "0 9 * * 1-5".',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'validate_cron',
    description:
      'Deeply validate a cron expression for correctness and common mistakes. ' +
      'Catches: impossible schedules (e.g. day 31 in Feb), OR-semantics gotchas (dom AND dow both ' +
      'restricted = either matches, not both), midnight scheduling spikes, uneven step values (*/7), ' +
      'leap-year edge cases, weekday-only warnings, and more. ' +
      'Returns warnings, observations, optimization suggestions, and an estimated yearly run count. ' +
      'Use this BEFORE deploying a cron job to catch silent failures.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The cron expression to validate.',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'next_runs',
    description:
      'Compute the next N scheduled run times for a cron expression. ' +
      'Returns ISO-8601 timestamps with relative offsets (+5m, +1h, +2d). ' +
      'Use this to preview when a job will actually fire before committing it.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The cron expression.',
        },
        count: {
          type: 'number',
          description: 'How many future runs to compute (default 5, max 50).',
          default: 5,
        },
        from: {
          type: 'string',
          description: 'ISO-8601 start time (defaults to now).',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'cron_presets',
    description:
      'Return a library of common cron expression presets (every 5 min, hourly, daily at midnight, ' +
      'weekdays 9am, monthly, quarterly, yearly, etc.) with their plain-English labels. ' +
      'Use this when a user asks for a "common" or "standard" schedule and you want to offer proven starting points.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ---- Tool handlers ----

function handleParse(args) {
  const { expression } = args;
  try {
    const parsed = cron.parseCron(expression);
    const description = cron.describeParsed(parsed);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              expression,
              valid: true,
              description,
              fields: {
                minute: parsed.minute?.raw,
                hour: parsed.hour?.raw,
                'day-of-month': parsed.dom?.raw,
                month: parsed.month?.raw,
                'day-of-week': parsed.dow?.raw,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (err) {
    return errorResult(expression, err);
  }
}

function handleValidate(args) {
  const { expression } = args;
  try {
    const result = cron.validate(expression);
    // Don't dump the huge `parsed` object — it's noise for an LLM. Keep the signal.
    const summary = {
      expression,
      valid: result.valid,
      description: result.description,
      warnings: result.warnings || [],
      observations: result.observations || [],
      suggestions: result.suggestions || [],
    };
    if (result.observations) {
      const freqObs = result.observations.find((o) => o.message.includes('frequency'));
      if (freqObs) summary.frequency_note = freqObs.message;
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  } catch (err) {
    return errorResult(expression, err);
  }
}

function handleNextRuns(args) {
  const { expression, count = 5, from } = args;
  const n = Math.min(Math.max(1, count), 50);
  const fromDate = from ? new Date(from) : new Date();
  if (isNaN(fromDate.getTime())) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Invalid 'from' date: ${from}` }],
    };
  }
  try {
    cron.parseCron(expression); // validate first
    const runs = cron.nextRuns(expression, fromDate, n);
    const formatted = cron.formatNextRuns(runs, fromDate);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              expression,
              from: fromDate.toISOString(),
              count: formatted.length,
              next_runs: formatted.map((r) => ({
                date: r.formatted,
                relative: r.relative,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (err) {
    return errorResult(expression, err);
  }
}

function handlePresets() {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            presets: cron.PRESETS,
            common: cron.COMMON,
            note: 'Standard 5-field cron expressions. Safe to use directly.',
          },
          null,
          2
        ),
      },
    ],
  };
}

function errorResult(expression, err) {
  const field =
    err.fieldIndex !== undefined && cron.FIELDS[err.fieldIndex]
      ? cron.FIELDS[err.fieldIndex].name
      : undefined;
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            expression,
            valid: false,
            error: err.message,
            field,
            tip: field
              ? `Fix the ${field} field (field ${(err.fieldIndex || 0) + 1} of 5).`
              : 'Check the expression syntax. Standard format: minute hour day-of-month month day-of-week.',
          },
          null,
          2
        ),
      },
    ],
  };
}

// ---- MCP server wiring ----

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case 'parse_cron':
        return handleParse(args || {});
      case 'validate_cron':
        return handleValidate(args || {});
      case 'next_runs':
        return handleNextRuns(args || {});
      case 'cron_presets':
        return handlePresets();
      default:
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Internal error: ${err.message}` }],
    };
  }
});

// ---- Start ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr (stdout is reserved for MCP protocol frames)
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} running on stdio`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
