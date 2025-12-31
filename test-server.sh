#!/bin/bash

# Start the server in the background
echo "Starting Pro-Todo MCP server..."
PORT=3000 bun index.ts . &
SERVER_PID=$!

# Wait for server to start
sleep 3

# Helper to send JSON-RPC requests
mcp_call() {
  local method=$1
  local params=$2
  local id=$3
  curl -s -X POST http://localhost:3000/ \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"$method\",\"params\":$params,\"id\":$id}"
}

echo "--- 1. Testing tools/list (Discovery) ---"
mcp_call "tools/list" "{}" 1

echo -e "\n--- 2. Adding a Pro task with Priority and Due Date ---"
mcp_call "tools/call" '{"name":"add-todo","arguments":{"name":"Finalize PRD [!!!] @2024-01-01 #work"}}' 2

echo -e "\n--- 3. Listing tasks in TODO.md ---"
mcp_call "tools/call" '{"name":"list-todos","arguments":{}}' 3

echo -e "\n--- 4. Adding task to a secondary list (shopping) ---"
mcp_call "tools/call" '{"name":"add-todo","arguments":{"name":"Buy Milk #groceries","listName":"shopping"}}' 4

echo -e "\n--- 5. Listing secondary list ---"
mcp_call "tools/call" '{"name":"list-todos","arguments":{"listName":"shopping"}}' 5

echo -e "\n--- 6. Toggling task completion ---"
mcp_call "tools/call" '{"name":"toggle-todo","arguments":{"keyword":"PRD"}}' 6

echo -e "\n--- 7. Verifying final list ---"
mcp_call "tools/call" '{"name":"list-todos","arguments":{}}' 7

# Cleanup
echo -e "\nKilling server process ($SERVER_PID)..."
kill $SERVER_PID
echo "Done."
