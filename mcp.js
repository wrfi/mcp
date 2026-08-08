#!/usr/bin/env node
import crypto from "node:crypto";
/**
 * wrfi MCP server — stdio transport.
 * Exposes wr.fi tools to Claude Desktop, Cursor, and other MCP clients.
 *
 * Usage: npx wrfi mcp
 * Config: WRFI_API_KEY env var for authenticated operations.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const PKG_VERSION = createRequire(import.meta.url)("./package.json").version;
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { push, read, readRaw, readHandoff, update, append, tail, diff, history, search, neighborhood, catchup } from "./lib/api.js";

const TOOLS = [
  {
    name: "wrfi_push",
    description: "Push content to wr.fi. Returns a URL + handoff bundle for agent-to-agent transfer. No auth needed for anonymous (30-day expiry). Response includes handoff.url for the next agent.",
    inputSchema: {
      type: "object",
      required: ["title", "content"],
      properties: {
        title: { type: "string", description: "Title for the creation" },
        content: { type: "string", description: "Text content (no base64 needed). Language auto-detected." },
        contentType: { type: "string", description: "Type: code, text, image, audio, video. Auto-detected if omitted." },
        description: { type: "string", description: "Brief description for discoverability" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
        project: { type: "string", description: "Project name for grouping related creations" },
        handoffMessage: { type: "string", description: "Note for the next agent — what was done, what to do next" },
        secure: { type: "boolean", description: "Short-id mode. Anonymous pushes DEFAULT to an unguessable 8-char link; pass false for the short speakable form (public or low-sensitivity work only). Authenticated pushes default to speakable; pass true for unguessable." },
        unlisted: { type: "boolean", description: "Hide from explore and search" },
        password: { type: "string", description: "Password-protect the creation" },
        status: { type: "string", enum: ["open", "done", "needs-human"], description: "Relay status — open: wants a next leg; done: complete; needs-human: waiting on a person" },
        task: { type: "object", description: "Workflow-state layer: { objective, requestedAction, completed[], openQuestions[], decisions[], risks[{severity,text}], acceptanceCriteria[] }. Inherited across versions unless replaced; null clears." },
        environment: { type: "object", description: "The workspace the next agent needs: { mcp: [{name, command, args, registry?}], skills: [{name, source}], plugins?: [...] }. Declarative only — reconstituted with per-item human consent via wrfi setup." },
        dryRun: { type: "boolean", description: "Validate without persisting" },
        apiKey: { type: "string", description: "API key for permanent creation" },
      },
    },
  },
  {
    name: "wrfi_push_secure",
    description: "Push with an unguessable 8-char link. Anonymous pushes already default to this — use it to force the unguessable id on an AUTHENTICATED push, which otherwise defaults to the speakable form.",
    inputSchema: {
      type: "object",
      required: ["title", "content"],
      properties: {
        title: { type: "string", description: "Title for the creation" },
        content: { type: "string", description: "Text content (no base64 needed). Language auto-detected." },
        contentType: { type: "string", description: "Type: code, text, image, audio, video. Auto-detected if omitted." },
        description: { type: "string", description: "Brief description for discoverability" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
        project: { type: "string", description: "Project name for grouping related creations" },
        handoffMessage: { type: "string", description: "Note for the next agent — what was done, what to do next" },
        secure: { type: "boolean", description: "Short-id mode. Anonymous pushes DEFAULT to an unguessable 8-char link; pass false for the short speakable form (public or low-sensitivity work only). Authenticated pushes default to speakable; pass true for unguessable." },
        unlisted: { type: "boolean", description: "Hide from explore and search" },
        password: { type: "string", description: "Password-protect the creation" },
        status: { type: "string", enum: ["open", "done", "needs-human"], description: "Relay status — open: wants a next leg; done: complete; needs-human: waiting on a person" },
        task: { type: "object", description: "Workflow-state layer: { objective, requestedAction, completed[], openQuestions[], decisions[], risks[{severity,text}], acceptanceCriteria[] }. Inherited across versions unless replaced; null clears." },
        environment: { type: "object", description: "The workspace the next agent needs: { mcp: [{name, command, args, registry?}], skills: [{name, source}], plugins?: [...] }. Declarative only — reconstituted with per-item human consent via wrfi setup." },
        dryRun: { type: "boolean", description: "Validate without persisting" },
        apiKey: { type: "string", description: "API key for permanent creation" },
      },
    },
  },
  {
    name: "wrfi_read",
    description: "Read a creation from wr.fi by its short ID. Returns the content and metadata.",
    inputSchema: {
      type: "object",
      required: ["shortId"],
      properties: {
        shortId: { type: "string", description: "Short ID (e.g. a028, bg8u)" },
        password: { type: "string", description: "Password for protected creations" },
        editToken: { type: "string", description: "Edit token grants read access too" },
        apiKey: { type: "string" },
      },
    },
  },
  {
    name: "wrfi_update",
    description: "Update an existing creation (new version, same URL). Returns updated handoff bundle. Requires edit token or API key.",
    inputSchema: {
      type: "object",
      required: ["shortId"],
      properties: {
        shortId: { type: "string", description: "Short ID to update" },
        content: { type: "string", description: "New text content (optional — omit for a metadata-only update: status/task/environment change carries content forward)" },
        editToken: { type: "string", description: "2-word edit token (e.g. Blue-Castle)" },
        apiKey: { type: "string", description: "API key (alternative to edit token)" },
        message: { type: "string", description: "Version note (what changed)" },
        handoffMessage: { type: "string", description: "Note for the next agent (what to do next)" },
        expectedVersion: { type: "number", description: "Guard against races: reject with 409 if the creation isn't at this version. Omit and the server's current version is read and used automatically (safe by default)." },
        status: { type: "string", enum: ["open", "done", "needs-human"], description: "Relay status — open: wants a next leg; done: complete; needs-human: waiting on a person" },
        task: { type: "object", description: "Workflow-state layer: { objective, requestedAction, completed[], openQuestions[], decisions[], risks[{severity,text}], acceptanceCriteria[] }. Inherited across versions unless replaced; null clears." },
        environment: { type: "object", description: "The workspace the next agent needs: { mcp: [{name, command, args, registry?}], skills: [{name, source}], plugins?: [...] }. Declarative only — reconstituted with per-item human consent via wrfi setup." },
        force: { type: "boolean", description: "Last-write-wins: skip the version check and overwrite whatever is current. Audited (response carries forced: true). Use only to intentionally discard concurrent changes." },
      },
    },
  },
  {
    name: "wrfi_append",
    description: "Append text to a creation without reading it first — server-serialized, never conflicts by default. Ideal for logs, running notes, and multi-agent journals. Each append becomes a new version (max 64 KB per entry).",
    inputSchema: {
      type: "object",
      required: ["shortId", "text"],
      properties: {
        shortId: { type: "string", description: "Short ID to append to" },
        text: { type: "string", description: "Text to append" },
        author: { type: "string", description: "Author label shown per entry (e.g. crawler-2)" },
        message: { type: "string", description: "Version note (what this entry is)" },
        expectedVersion: { type: "number", description: "Strict mode — 409 unless the creation is at this version. Omit for the never-conflict default." },
        idempotencyKey: { type: "string", description: "Repeating the same key within 10 min returns the first result instead of appending again (retry-safe)" },
        appendToken: { type: "string", description: "Append-only token (wrfi_ap_...) — narrower than an edit token" },
        editToken: { type: "string", description: "2-word edit token (e.g. Blue-Castle)" },
        apiKey: { type: "string" },
      },
    },
  },
  {
    name: "wrfi_tail",
    description: "Read the last N append entries of a creation (1-100), append-aware with author + version per entry. Cheaper than reading the whole creation — use to catch up on a journal.",
    inputSchema: {
      type: "object",
      required: ["shortId"],
      properties: {
        after: { type: "number", description: "Cursor: only entries with version > after. Poll with the last version you saw — never miss a burst." },
        shortId: { type: "string", description: "Short ID" },
        n: { type: "number", description: "Number of entries (default 10, max 100)" },
        json: { type: "boolean", description: "Return structured JSON { version, count, entries } instead of text" },
        password: { type: "string" },
        editToken: { type: "string" },
        apiKey: { type: "string" },
      },
    },
  },
  {
    name: "wrfi_diff",
    description: "Get a unified diff between two versions of a creation. Efficient for syncing changes.",
    inputSchema: {
      type: "object",
      required: ["shortId", "from"],
      properties: {
        shortId: { type: "string", description: "Short ID" },
        from: { type: "number", description: "From version number" },
        to: { type: "number", description: "To version number (default: latest)" },
        password: { type: "string" },
        editToken: { type: "string" },
        apiKey: { type: "string" },
      },
    },
  },
  {
    name: "wrfi_search",
    description: "Search for creations on wr.fi. Returns titles, shortIds, and content types. Use to discover existing context before creating new content.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (matches title, description, tags)" },
        project: { type: "string", description: "Filter by project name" },
        type: { type: "string", description: "Filter by content type (code, text, image, etc.)" },
        limit: { type: "number", description: "Max results (default 10, max 50)" },
      },
    },
  },
  {
    name: "wrfi_neighborhood",
    description: "Get the context neighborhood for a creation: backlinks, outbound links, project siblings, and related creations. Use to understand what context exists around a creation.",
    inputSchema: {
      type: "object",
      required: ["shortId"],
      properties: {
        shortId: { type: "string", description: "Short ID of the creation" },
      },
    },
  },
  {
    name: "wrfi_handoff",
    description: "Read the handoff view for a creation — structured text with content, history, context, and update instructions. Use this to pick up work from another agent.",
    inputSchema: {
      type: "object",
      required: ["shortId"],
      properties: {
        shortId: { type: "string", description: "Short ID of the creation" },
        compact: { type: "boolean", description: "Compact mode — skip verbose update instructions (saves tokens)" },
        password: { type: "string" },
        editToken: { type: "string" },
      },
    },
  },
  {
    name: "wrfi_catchup",
    description: "\"I last saw version N — what changed?\" Returns per-version messages, a unified diff (or a condensed summary), and the exact expectedVersion to write with next. THE way to resume work on a handoff you've seen before — cheaper than re-reading everything.",
    inputSchema: {
      type: "object",
      required: ["shortId", "since"],
      properties: {
        shortId: { type: "string", description: "Short ID to catch up on" },
        since: { type: "number", description: "The version you last read (>= 1)" },
        summary: { type: "boolean", description: "Condensed form: headline + per-version messages, no diff body" },
        password: { type: "string", description: "For password-protected creations" },
        editToken: { type: "string" },
        apiKey: { type: "string" },
      },
    },
  },
  {
    name: "wrfi_history",
    description: "Get version history for a creation. Shows version numbers, titles, messages, authors, and timestamps.",
    inputSchema: {
      type: "object",
      required: ["shortId"],
      properties: {
        shortId: { type: "string", description: "Short ID" },
        password: { type: "string" },
        editToken: { type: "string" },
        apiKey: { type: "string" },
      },
    },
  },
];

async function handleTool(name, args) {
  switch (name) {
    case "wrfi_push":
      return await push(args);

    case "wrfi_push_secure":
      return await push({ ...args, secure: true });

    case "wrfi_read": {
      const data = await read(args.shortId, args);
      // Also fetch raw text for convenience
      let rawText;
      try { rawText = await readRaw(args.shortId, args); } catch { rawText = null; }
      return { ...data, rawContent: rawText };
    }

    case "wrfi_update":
      return await update(args.shortId, args);

    case "wrfi_append":
      // Retry-safe by default: one UUID per tool call, reused across the
      // client's internal retries. Caller-supplied keys still win (useful for
      // retrying across process restarts).
      return await append(args.shortId, { ...args, idempotencyKey: args.idempotencyKey || crypto.randomUUID() });

    case "wrfi_catchup":
      return await catchup(args.shortId, args.since, args);

    case "wrfi_tail":
      // Shared api.js tail(shortId, n, opts) — clamp n to the server's 1-100.
      return await tail(args.shortId, Math.min(Math.max(args.n ?? 10, 1), 100), args);

    case "wrfi_diff":
      return await diff(args.shortId, args.from, args.to || null, args);

    case "wrfi_search":
      return await search(args);

    case "wrfi_neighborhood":
      return await neighborhood(args.shortId, args);

    case "wrfi_handoff":
      return await readHandoff(args.shortId, args);

    case "wrfi_history":
      return await history(args.shortId, args);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function startMcpServer() {
  const server = new Server(
    // Keep in lockstep with package.json — this is what MCP clients display.
    // Derived, not hardcoded: a handshake advertising a different version than
    // the installed package is exactly the drift the compatibility matrix cites.
    { name: "wrfi", version: PKG_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleTool(name, args || {});
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Auto-start when invoked as a script (`node mcp.js`, `npx wrfi-mcp`, `wrfi-mcp`).
function isMainModule() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  startMcpServer().catch((err) => {
    console.error(`MCP server error: ${err.message}`);
    process.exit(1);
  });
}
