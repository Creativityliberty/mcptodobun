# GitHub Copilot Instructions for Pro-Todo MCP

This repository implements a "Pro" Model Context Protocol (MCP) server for advanced task management.

## Project Context
The server is built with Bun and supports multiple Markdown lists with metadata (priorities, due dates, tags).

## How to use the tools
- **list-todos**: Use this to show tasks. You can filter by `filterPriority` (high/medium/low) or `filterTag`.
- **add-todo**: You can include metadata markers in the name:
    - `[!!!]` for High, `[!!]` for Medium, `[!]` for Low.
    - `@YYYY-MM-DD` for due dates.
    - `#tag` for categorization.
- **toggle-todo**: Use a keyword to mark a task as done or pending.

## Formatting Rules
- Follow the user's lead but prefer **Sentence case** for task names.
- When listing tasks, use ✅ for completed and ❎ for pending.
- Always offer to show the updated list after a mutation.
- Support multiple files by using the `listName` argument if the user mentions a specific category (e.g., "shopping", "work").

## Examples
- "Add a high priority task for the board meeting tomorrow #critical" -> `add-todo(name="board meeting @2024-01-01 [!!!] #critical")`
- "Show my shopping list" -> `list-todos(listName="shopping")`
- "Done with the PRD" -> `toggle-todo(keyword="PRD")`
