# cron-mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that lets AI coding agents — **Claude, Cursor, Copilot, Cline** — parse, validate, explain, and preview cron expressions.

Built to catch **silent cron bugs** (impossible schedules, OR-semantics gotchas, midnight spikes) *before* a job is deployed — a class of mistake that's easy to make and hard to notice until a critical job silently fails to fire.

## Why

Cron expressions are deceptively tricky. Common silent failures:

- `0 0 30 2 *` → **never runs** (February has no 30th). Syntactically valid, semantically dead.
- `0 0 1,15 * 1` → fires on **the 1st OR 15th OR Monday**, not "the 1st and 15th if Monday" (the classic dom+dow OR-semantics trap).
- `*/7 * * * *` → uneven step; intervals drift (`:00, :07, :14, …, :56, :00` — not "every 7 minutes" cleanly).
- `0 0 * * *` → **midnight spike**; every job in the system competes at 00:00.

`cron-mcp` surfaces these as warnings, observations, and suggestions that the AI agent can act on — *before* you ship the schedule.

## Tools exposed

| Tool | Description |
|------|-------------|
| `parse_cron` | Parse a cron expression → plain-English description of when it fires. Supports 5-field standard cron + `L` (last), `W` (nearest weekday), `#` (nth weekday), named months/days. |
| `validate_cron` | Deep validation: impossible schedules, OR-semantics, midnight spikes, uneven steps, leap-year edges, frequency estimate (~runs/year). |
| `next_runs` | Compute the next N fire times as ISO-8601 + relative offsets. |
| `cron_presets` | Library of common, proven schedules (every 5 min, hourly, weekdays 9am, monthly, quarterly, …). |

## Install

```bash
npm install -g cron-mcp-server
```

## Published links

- [npm package](https://www.npmjs.com/package/cron-mcp-server) — installable release `0.1.2`
- [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.takeaseatventure%2Fcron-mcp/versions/0.1.2) — registry record
- [GitHub release](https://github.com/takeaseatventure/cron-mcp/releases/tag/v0.1.2) — downloadable source checkpoint
- [Glama listing](https://glama.ai/mcp/servers/takeaseatventure/cron-mcp) — public directory listing and score page

## Configure

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your OS:

```json
{
  "mcpServers": {
    "cron": {
      "command": "cron-mcp-server",
      "args": []
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` (or `~/.cursor/mcp.json` for global):

```json
{
  "mcpServers": {
    "cron": {
      "command": "cron-mcp-server"
    }
  }
}
```

### VS Code (Copilot)

```json
{
  "mcp.servers": {
    "cron": {
      "type": "stdio",
      "command": "cron-mcp-server"
    }
  }
}
```

### Direct (no install)

```bash
npx cron-mcp-server
```

## Example usage

Once connected, just ask the agent in natural language:

- *"Validate this cron: `0 0 30 2 *`"*
- *"When does `*/5 * * * *` next fire?"*
- *"Give me a cron for every weekday at 9am"*
- *"Is there anything risky about `0 0 1,15 * 1`?"*

The agent calls the tools and returns structured, actionable results.

## Engine

The cron engine is battle-tested: 638 lines, zero dependencies, originally extracted from a browser-based cron generator and hardened with 69 unit tests. This MCP server is a thin tool wrapper around it.

## License

MIT © [takeaseatventure](https://github.com/takeaseatventure)
