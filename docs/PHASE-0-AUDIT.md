# OpenCrewBot 2.0 - Repository Audit

## Baseline

- Framework: Next.js 16.4, React 19.3
- Agent runtime: Mastra 1.76
- Storage: LibSQL/SQLite
- Models: Nebius plus a mock model
- Integrations: Composio, MCP, Tavily, Browserbase
- Data: `data/opencrewbot.db` for application records and `data/mastra.db` for model-side threads
- Memory: editable Markdown files under `data/workspaces/<botId>/MEMORY.md`

## Existing capabilities

| Area | Existing state |
| --- | --- |
| Individual agents | Implemented: model, persona, tools, memory and permission settings |
| Conversations | Implemented: streamed chat, stop, clear and approval resumes |
| Rooms | Implemented: members, routing, mentions and hand-offs |
| Dynamic agents | Agent creation API and UI exist, but natural-language agent generation does not |
| Execution engine | Task planning, dependency checks, parallel ready tasks, retries and restart recovery exist |
| Execution UI | Backend routes and records exist; a dashboard is not exposed |
| Persistent memory | Individual Markdown memory exists and is editable |
| Shared memory | Database has memory records, but project and room scopes are not implemented |
| Approvals | Ask/full modes and chat approval cards exist; controlled access and durable action records do not |
| Integrations | Composio and MCP infrastructure exists; live verification is environment-dependent |
| Scheduled workflows | Not implemented |
| Skills | No reusable skill registry exists |
| Chief of Staff | No planner or automatic task assignment exists |

## Architectural constraints

1. `sendMessage` currently starts a bot or room turn directly; it does not create an execution plan.
2. Execution tasks call agents independently and pass only prerequisite text. It does not yet publish shared project memory or fan out room collaboration.
3. Approval state is carried in chat/tool events. A durable, centralized approval queue needs additional tables and APIs.
4. Bot approval has only `ask` and `full`. Controlled access and tool-level limits require a data model extension.
5. The seeded workforce has three agents and one room. The project needs eight configurable agents and four rooms without removing dynamic creation.
6. The existing dynamic bot API writes valid source-free agents, but the UI and server need a factory workflow based on natural language.

## Baseline verification

At the start of implementation:

- `pnpm exec tsc --noEmit`: failed in two dynamic execution routes due to stale Next.js route context typing.
- `pnpm lint`: failed for one `prefer-const` violation in `execution.ts`.
- Production build: passed.

## Phase 0 fixes

- Replaced stale execution route contexts with the Next.js 16 Promise-based params shape.
- Fixed the lint violation.
- Verified `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm build` pass.

## Recommended implementation order

1. Add normalized workflow, skill, memory, approval and audit records.
2. Add Chief of Staff planning and execution APIs.
3. Add dynamic agent generation.
4. Extend collaboration and memory.
5. Add the remaining UI, schedules, integrations and demonstrations.
