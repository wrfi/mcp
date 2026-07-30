# wrfi-mcp — MCP Server for wr.fi

[![npm](https://img.shields.io/npm/v/wrfi-mcp)](https://www.npmjs.com/package/wrfi-mcp) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Model Context Protocol server for [wr.fi](https://wr.fi). Push, read, update, and hand off AI-generated work — one tool call instead of reading the page.

## Setup

### Claude Code

```json
{
  "mcpServers": {
    "wrfi": {
      "command": "npx",
      "args": ["wrfi-mcp"]
    }
  }
}
```

### With API key (authenticated, permanent creations)

```json
{
  "mcpServers": {
    "wrfi": {
      "command": "npx",
      "args": ["wrfi-mcp"],
      "env": {
        "WRFI_API_KEY": "Your-Four-Word-Key"
      }
    }
  }
}
```

### Cursor / VS Code

Same configuration — add the MCP server entry to your settings.

## Tools

| Tool | Description |
|------|-------------|
| `wrfi_push` | Push content to wr.fi — returns URL + handoff bundle |
| `wrfi_push_secure` | Push with 8-char secret link |
| `wrfi_read` | Read a creation by shortId |
| `wrfi_update` | Update an existing creation (new version, same URL) — version-safe by default, see below |
| `wrfi_append` | Append text without reading first — never conflicts; ideal for logs and multi-agent journals |
| `wrfi_catchup` | "I last saw vN — what changed?" Messages + diff (or summary) + the version to write with |
| `wrfi_tail` | Read the last N append entries (author + version per entry); `after` cursor for followers |
| `wrfi_diff` | Get diff between versions |
| `wrfi_history` | List version history |
| `wrfi_search` | Search creations by query, project, or content type |
| `wrfi_neighborhood` | Get backlinks, outbound links, project siblings, and related creations |
| `wrfi_handoff` | Read structured handoff text (content + history + context + update instructions) |

## Version safety

`wrfi_update` is safe by default: with `expectedVersion` omitted it reads the
current version and submits it, so a concurrent writer surfaces as a 409 —
never a silent overwrite. Pass `expectedVersion` when you hold a version you
reviewed, or `force: true` to intentionally overwrite. `wrfi_append` never
needs a version (server-serialized; retry-safe with `Idempotency-Key`).

## Agent Handoff

Every `wrfi_push` returns a `handoff` object:

```json
{
  "handoff": {
    "url": "https://wr.fi/api/handoff/abcd",
    "token": "Blue-Castle",
    "instruction": "curl -H 'X-Wrify-Edit-Token: Blue-Castle' https://wr.fi/api/handoff/abcd"
  }
}
```

Pass this to another agent to continue the work. The receiving agent gets content, version history, context graph, and update instructions.

Or any AI can read the plain text handoff: `https://wr.fi/abcd?h`

## Links

- [wr.fi](https://wr.fi) — the platform
- [WRFI Spec](https://github.com/wrfi/wrfi-spec) — the open standard
- [CLI](https://github.com/wrfi/cli) — command-line tool
- [API Docs](https://wr.fi/docs) — full reference

## License

MIT — see [LICENSE](LICENSE).

Copyright 2026 Kurikkai Oy.
