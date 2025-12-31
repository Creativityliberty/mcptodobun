# AI Master Guide: Building a Bun MCP Server

This document serves as the **Ground Truth** for any AI agent tasked with building or maintaining a Model Context Protocol (MCP) server using the **Bun** runtime. It distills the patterns used in the `mcptodobun` repository.

## 1. Project Initialization

**Why Bun?**
- Native TypeScript support (no compilation step needed).
- High performance file I/O.
- Fast package installation.

**Command Pattern:**
```bash
mkdir -p my-mcp-server && cd my-mcp-server
bun init -y
bun add @modelcontextprotocol/sdk zod
bun add -D @types/bun
```

## 2. Core Architecture (`index.ts`)

The entry point must handle:
1.  **Transport**: We use `StreamableHTTPServerTransport` for maximum compatibility (HTTP/SSE).
2.  **Compatibility**: We use Node's `http.createServer` because `Bun.serve` is not yet strictly compatible with the MCP SDK types.
3.  **Persistence**: We use `Bun.file()` for native, fast I/O.

**Template structure:**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { file, write } from "bun";
import { createServer } from "http";

// 1. Initialize Server
const mcpServer = new McpServer({
  name: "my-server",
  version: "1.0.0",
});

// 2. Define Persistence Helpers
async function loadData() {
    const f = file("data.json");
    return (await f.exists()) ? await f.json() : {};
}

// 3. Register Tools
mcpServer.tool(
  "my-tool",
  "Description of what the tool does",
  { param: z.string() }, // Zod schema
  async ({ param }) => {
    // Logic here
    return { content: [{ type: "text", text: `Result: ${param}` }] };
  }
);

// 4. Transport Setup (Standard Pattern)
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
});

await mcpServer.connect(transport);

const httpServer = createServer(async (req, res) => {
  if (req.method !== "POST") return res.writeHead(404).end();
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  await transport.handleRequest(req, res, body);
});

httpServer.listen(3000, () => console.log("MCP Server running on port 3000"));
```

## 3. "Pro" Features Pattern

To elevate a server from "prototype" to "production-ready", implement:

### Metadata Parsing
Do not just store text. Parse it for semantic meaning.
- **Priority**: `[!!!]`, `[!!]`, `[!]`
- **Dates**: `@YYYY-MM-DD`
- **Tags**: `#tag`

### Multi-Tenancy (Files/Lists)
Avoid singletons. Allow users to specify a context (e.g., `listName`).
```typescript
mcpServer.tool("list", "...", { listName: z.string().default("default") }, ...);
```

### Webhooks
Enable external integrations without blocking the thread.
```typescript
if (process.env.WEBHOOK_URL) {
    fetch(process.env.WEBHOOK_URL, { method: "POST", body: ... }).catch(console.error);
}
```

## 4. Verification Pattern

Do not rely on `jq` or complex dependencies. Use simple `curl` scripts that print the raw output.

**`test-server.sh` Template:**
```bash
#!/bin/bash
# Start server
PORT=3000 bun index.ts . &
PID=$!
sleep 2

# Test Function
call_tool() {
    curl -s -X POST http://localhost:3000/ \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":$1,\"id\":1}"
}

# Execute
call_tool '{"name":"my-tool","arguments":{"param":"test"}}'

# Cleanup
kill $PID
```

## 5. Deployment

**Dockerfile for Bun:**
```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY package.json .
RUN bun install
COPY . .
EXPOSE 3000
CMD ["bun", "index.ts"]
```

## 6. Common Pitfalls to Avoid

1.  **Argument Parsing**: Always check `process.argv` if your server needs a workspace path.
2.  **Type Compatibility**: Do not try to force `Bun.serve` with the current MCP SDK; use `http.createServer`.
3.  **Event Stream Headers**: Clients must send `Accept: application/json, text/event-stream` or the SDK will reject the request (406 Not Acceptable).
