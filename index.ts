import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { file, write } from "bun";
import { createServer } from "http";
import { join } from "path";

// Support for workspace directory via CLI argument
const workspacePath = process.argv[2];
if (!workspacePath) {
    throw new Error(
        'Please provide the workspace path as the first argument: bun run index.ts <path>'
    );
}
process.chdir(workspacePath);

const mcpServer = new McpServer({
    name: "pro-todo",
    version: "1.0.0",
    capabilities: {
        tools: {},
    },
});

/**
 * Metadata Parsing Utilities
 */
interface TodoMetadata {
    priority?: "low" | "medium" | "high";
    dueDate?: string;
    tags: string[];
}

interface TodoItem {
    name: string;
    isChecked: boolean;
    metadata: TodoMetadata;
    rawLine: string;
}

function parseTodoLine(line: string): TodoItem {
    const isChecked = line.startsWith("- [x] ");
    const content = line.replace(/^- \[[x ]\] /, "").trim();

    const metadata: TodoMetadata = { tags: [] };

    // Parse Priority: [!!!] = high, [!!] = medium, [!] = low
    if (content.includes("[!!!]")) metadata.priority = "high";
    else if (content.includes("[!!]")) metadata.priority = "medium";
    else if (content.includes("[!]")) metadata.priority = "low";

    // Parse Due Date: @YYYY-MM-DD
    const dateMatch = content.match(/@(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) metadata.dueDate = dateMatch[1];

    // Parse Tags: #tag
    const tagMatches = content.match(/#(\w+)/g);
    if (tagMatches) metadata.tags = tagMatches.map(t => t.slice(1));

    // Clean name (remove metadata markers for display)
    const name = content
        .replace(/\[!+\]/g, "")
        .replace(/@\d{4}-\d{2}-\d{2}/g, "")
        .replace(/#\w+/g, "")
        .trim();

    return { name, isChecked, metadata, rawLine: line };
}

async function readTodos(listName: string = "TODO") {
    const fileName = `${listName}.md`;
    const text = (await file(fileName).exists()) ? await file(fileName).text() : "";
    return text.split("\n").filter((line) => line.trim() !== "").map(parseTodoLine);
}

async function writeTodos(todos: TodoItem[], listName: string = "TODO") {
    const fileName = `${listName}.md`;
    const content = todos
        .map((todo) => todo.rawLine)
        .join("\n");
    await write(fileName, content + "\n");
}

/**
 * MCP Tools
 */

// LIST
mcpServer.tool(
    "list-todos",
    "Lists all to-do items from a specific list (default: TODO). Supports filtering by priority/tags.",
    {
        listName: z.string().optional().default("TODO"),
        filterPriority: z.enum(["low", "medium", "high"]).optional(),
        filterTag: z.string().optional(),
    },
    async ({ listName, filterPriority, filterTag }) => {
        let todos = await readTodos(listName);

        if (filterPriority) todos = todos.filter(t => t.metadata.priority === filterPriority);
        if (filterTag) todos = todos.filter(t => t.metadata.tags.includes(filterTag));

        const text = todos.length > 0
            ? todos.map(t => {
                const status = t.isChecked ? "✅" : "❎";
                const prio = t.metadata.priority ? ` [${t.metadata.priority.toUpperCase()}]` : "";
                const date = t.metadata.dueDate ? ` (Due: ${t.metadata.dueDate})` : "";
                const tags = t.metadata.tags.length > 0 ? ` #${t.metadata.tags.join(" #")}` : "";
                return `${status} ${t.name}${prio}${date}${tags}`;
            }).join("\n")
            : "No tasks found.";

        return { content: [{ type: "text", text }] };
    }
);

// ADD
mcpServer.tool(
    "add-todo",
    "Adds a new task with optional priority ([!], [!!], [!!!]), due date (@YYYY-MM-DD), and tags (#tag).",
    {
        name: z.string().describe("Task name + metadata markers"),
        listName: z.string().optional().default("TODO"),
    },
    async ({ name, listName }) => {
        const todos = await readTodos(listName);
        const rawLine = `- [ ] ${name}`;
        todos.push(parseTodoLine(rawLine));
        await writeTodos(todos, listName);

        return { content: [{ type: "text", text: `Added to ${listName}: ${name}` }] };
    }
);

// TOGGLE
mcpServer.tool(
    "toggle-todo",
    "Toggles the completion status of a task matching a keyword.",
    {
        keyword: z.string().describe("Keyword to find the task"),
        listName: z.string().optional().default("TODO"),
    },
    async ({ keyword, listName }) => {
        const todos = await readTodos(listName);
        const todo = todos.find((t) => t.name.toLowerCase().includes(keyword.toLowerCase()));

        if (!todo) return { content: [{ type: "text", text: `Task "${keyword}" not found in ${listName}.md` }] };

        todo.isChecked = !todo.isChecked;
        // Reconstruction of raw line while preserving meta (simplified for prototype)
        const status = todo.isChecked ? "x" : " ";
        const originalContent = todo.rawLine.replace(/^- \[[x ]\] /, "");
        todo.rawLine = `- [${status}] ${originalContent}`;

        await writeTodos(todos, listName);

        // [Pro] Webhook Notification
        const webhookUrl = process.env.WEBHOOK_URL;
        if (todo.isChecked && webhookUrl) {
            try {
                await fetch(webhookUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        event: "task_completed",
                        task: todo.name,
                        list: listName,
                        timestamp: new Date().toISOString()
                    })
                });
                console.log(`Webhook triggered for ${todo.name}`);
            } catch (err) {
                console.error(`Webhook failed: ${err}`);
            }
        }

        return {
            content: [{
                type: "text",
                text: `"${todo.name}" is now ${todo.isChecked ? "COMPLETED ✅" : "PENDING ❎"}`
            }]
        };
    }
);

/**
 * Transport Setup
 */
const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
});

await mcpServer.connect(transport);

const httpServer = createServer(async (req, res) => {
    if (req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);

    try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        await transport.handleRequest(req, res, body);
    } catch (err) {
        res.writeHead(400);
        res.end("Invalid JSON Body");
    }
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
httpServer.listen(PORT, () => {
    console.log(`Pro-Todo MCP Server listening on http://localhost:${PORT}`);
    console.log(`Workspace: ${process.cwd()}`);
});