'use strict';
// e2e-mcp.js — End-to-end test of the cron MCP server over stdio transport.
// Spawns `node index.js`, performs the MCP initialize handshake, lists tools,
// calls parse_cron + validate_cron, and verifies the responses.

const { spawn } = require('node:child_process');

const child = spawn('node', ['index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';
const results = {};
let nextId = 1;
let pendingResolve = null;

function send(method, params) {
  const id = nextId++;
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
  return new Promise((resolve) => {
    pendingResolve = { id, resolve };
    child.stdin.write(msg);
  });
}

function sendNotification(method, params) {
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
  child.stdin.write(msg);
}

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pendingResolve && msg.id === pendingResolve.id) {
      const r = pendingResolve;
      pendingResolve = null;
      r.resolve(msg);
    }
  }
});

child.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d));

async function main() {
  try {
    // 1. Initialize handshake
    const init = await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '1.0.0' },
    });
    results.initialize = init;
    console.log('1. initialize:', init.error ? 'FAIL' : 'OK', JSON.stringify(init.result?.serverInfo));

    // 2. Send initialized notification
    sendNotification('notifications/initialized', {});

    // 3. List tools
    const toolsResp = await send('tools/list', {});
    results.toolsList = toolsResp;
    const toolNames = toolsResp.result?.tools?.map((t) => t.name) || [];
    console.log('2. tools/list:', toolsResp.error ? 'FAIL' : 'OK', toolNames.join(', '));

    // 4. Call parse_cron
    const parseResp = await send('tools/call', {
      name: 'parse_cron',
      arguments: { expression: '*/5 * * * *' },
    });
    results.parseCron = parseResp;
    const parseText = parseResp.result?.content?.[0]?.text;
    console.log('3. parse_cron:', parseResp.error ? 'FAIL' : 'OK', parseText?.slice(0, 80));

    // 5. Call validate_cron on an impossible schedule
    const valResp = await send('tools/call', {
      name: 'validate_cron',
      arguments: { expression: '0 0 30 2 *' },
    });
    results.validateCron = valResp;
    const valText = valResp.result?.content?.[0]?.text;
    console.log('4. validate_cron (Feb 30):', valResp.error ? 'FAIL' : 'OK');
    console.log('   response:', valText?.slice(0, 120));

    // 6. Call next_runs
    const nextResp = await send('tools/call', {
      name: 'next_runs',
      arguments: { expression: '0 9 * * 1-5', count: 3 },
    });
    results.nextRuns = nextResp;
    console.log('5. next_runs:', nextResp.error ? 'FAIL' : 'OK');

    // 7. Call presets
    const presetResp = await send('tools/call', {
      name: 'cron_presets',
      arguments: {},
    });
    results.presets = presetResp;
    console.log('6. cron_presets:', presetResp.error ? 'FAIL' : 'OK');

    // Verify
    const allOk =
      !init.error &&
      !toolsResp.error &&
      toolNames.length === 4 &&
      !parseResp.error &&
      !valResp.error &&
      valText && valText.includes('never') &&
      !nextResp.error &&
      !presetResp.error;

    console.log('\n=== E2E RESULT:', allOk ? 'PASS ✅' : 'FAIL ❌ ===');
    if (!allOk) {
      console.log('Details:', JSON.stringify(results, null, 2).slice(0, 2000));
    }
  } catch (e) {
    console.error('Test error:', e);
  } finally {
    child.kill();
    process.exit(0);
  }
}

main();
