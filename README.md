<div align="center">

<img src="docs/logo.svg" alt="OpenCrewBot mascot" width="96" height="96">

# OpenCrewBot

### Your own team of AI bots, in one chat app.

**An open-source alternative to Grok Bot, on open models. Each bot has its own model, tools, memory and cloud browser.**

Built with [Mastra](https://mastra.ai) and [Nebius Token Factory](https://tokenfactory.nebius.com) · [Get started](#get-started) · [Overview](#overview) · [Architecture](#architecture) · [Features](#features) · [Data and privacy](#data-and-privacy)

![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![Mastra](https://img.shields.io/badge/harness-Mastra-6d28d9)
![Nebius Token Factory](https://img.shields.io/badge/models-Nebius%20Token%20Factory-e0ff4f?labelColor=0b0b0b)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Built by Studio1 team](https://img.shields.io/badge/built%20by-Studio1%20team-ff6b1a)](https://studio1hq.com)

Run OpenCrewBot on your own machine. Bring a Nebius Token Factory key or configure an OpenAI-compatible provider for model calls. Tavily, Browserbase, Jev and Composio credentials enable their respective integrations. Without model credentials, the app uses mock mode so you can try the interface first.

</div>

---

<div align="center">

<table><tr><td>

<img src="docs/screenshots/hero.png" alt="OpenCrewBot: a chat with Scout, a research bot, showing a web search, a sourced answer and a memory save, with the bot's details panel open" width="900">

</td></tr></table>

</div>

_Ask, search, answer, remember. Scout searches the web with Tavily, answers with its sources, and saves a decision to its own `MEMORY.md`. Staged example content; the interface is real._

## Overview

OpenCrewBot treats AI as a messaging app. Every contact in the sidebar is a bot with its own persona, its own open-source model, its own tools and its own memory. Talk to one bot directly, or put several in a room and let them split the work.

**A starting point, not a hosted product.** You run the app and bring your own keys. It's early: the [Features](#features) section says what's included and what has been verified so far.

### Bots

Give each bot a name, a role, instructions, a model and a set of tools. Each reply shows its tokens and cost.

**Choose the model from the bot's Details.** **Change** opens a model sheet with the available models, search, context size, tool support and price when known. OpenAI-compatible endpoints can be added through server configuration. Executions try their task model, agent model and configured fallbacks in order when a model call fails. Automatic per-message model routing is not provided.

The agent factory can generate a bot definition from an instruction and validates the model, tools, skills and fallback models against configured options. The details panel keeps a short summary of the bot, with the full editor one click away. Changes apply from the bot's next reply.

### Rooms

Put bots in a room and talk to all of them at once. @mention a bot to choose who answers, or `@everyone`. With no mention, an **Auto** room asks [Jev](https://typesafe.ai), TypeSafe's decision model, to pick the best bot in a few hundred milliseconds. If Jev isn't sure, the room's lead answers. A bot can @mention a teammate to hand work on, up to two hops.

<div align="center">

<table><tr><td>

<img src="docs/screenshots/room.png" alt="The Studio room: Atlas, picked by Jev with 91% confidence, plans a launch and hands research to Scout and drafting to Quill" width="900">

</td></tr></table>

</div>

_One message, three bots. Jev picks Atlas to answer, Atlas hands research to Scout and drafting to Quill. Staged example content._

Room responses can run concurrently. The room records intermediate contributions and hand-offs, then gives a peer a bounded review turn. A review may challenge a contribution and request a correction; model-generated reviews are advisory and are not a guarantee of factual verification.

### Workforce operations

The Chief of Staff asks a selected planner agent for a dependency-aware plan, validates task assignments and dependencies, and creates an execution. If the response cannot be used, it falls back to contributions from the configured specialist roster and a consolidation task. The execution engine runs ready tasks concurrently, tracks attempts and status, supports cancellation and retries, and recovers interrupted tasks.

Create workflow templates from task definitions, run them manually, or schedule them with five-field UTC cron expressions. Execution history, approvals, shared memory and workflow controls are available from the Operations panel.

### Skills

Eight reusable skills are seeded and can be assigned to agents. Relevant skills are selected from their definitions and instructions; declared built-in capabilities can be enabled in the agent runtime. Skill selection uses text matching and is not an unrestricted tool/plugin system.

### Memory

Each bot keeps its notes in one plain Markdown file, `data/workspaces/<botId>/MEMORY.md`. The first 200 lines load into the bot's prompt every turn. The bot adds and fixes lines with two small tools, `memory_add` and `memory_edit`, and you can read or edit the same file in the Memory tab, or in any editor. Anything that looks like a password, token or key is redacted before it's written.

Shared project memory is included in execution task context, and shared room memory is included in room prompts. Shared memory can also be managed by scope from the Operations panel.

<div align="center">

<table><tr><td>

<img src="docs/screenshots/memory.png" alt="Scout's Memory tab showing its MEMORY.md, with notes about the person and decisions" width="900">

</td></tr></table>

</div>

_The Memory tab is the file itself. The panel refreshes live when the bot writes to it._

### Ask before acting

On **Ask first**, a bot stops before a tool action and shows an approval card in chat. **Allow once** runs it; **Always allow** adds that exact tool name to the bot's controlled allowlist; **Deny** rejects it. **Controlled access** only auto-approves explicitly allowed tool names; other tools still ask. **Full access** acts without asking. Decisions and expirations are recorded centrally. Bots can pause to ask you a question, with suggested answers as buttons, and resume when you reply.

<div align="center">

<table><tr><td>

<img src="docs/screenshots/approval.png" alt="Quill asks to open tokenfactory.nebius.com in its browser and waits for Allow once or Deny" width="900">

</td></tr></table>

</div>

_Nothing happens until you choose. Staged example content._

### Tools

| Tool | What it does | Powered by |
| --- | --- | --- |
| Web search | Search, read pages and crawl sites, with sources shown under the answer | [Tavily](https://tavily.com) via `@mastra/tavily` |
| Memory | Read and update the bot's own `MEMORY.md` | Local files |
| Code mode | The model writes one TypeScript function that calls several tools at once, so multi-step questions take one round trip | Mastra Code Mode, in a QuickJS (WebAssembly) sandbox |
| Browser | A real cloud browser for pages that need clicks, forms or JavaScript. Watch it live from the chat and click in to take over | [Browserbase](https://www.browserbase.com) via Mastra `AgentBrowser` |
| Ask me | Pause and ask you a question with a card in chat | Mastra `ask_user` |

### Connections

Give bots access to Slack, GitHub, Gmail, Notion and the rest of your tools. Open **Connections** from the plug icon in the sidebar:

- **Apps via [Composio](https://composio.dev).** Click **Connect**, sign in on the app's own page, and come back. Composio handles each app's sign-in and tokens, with 1,000+ apps available through search.
- **Your own MCP servers.** Add any remote MCP server by URL and token. There's a preset for GitHub's official server (`https://api.githubcopilot.com/mcp/`, with a personal access token). **Add and test** connects straight away and reports how many tools it offers.

Then switch each connection on for the bots that should have it, in the bot's Details. Lookups run on their own; anything that changes something (sending a message, opening an issue) shows an approval card first, unless the bot has full access. Tokens stay on the server.

## Architecture

### Mastra runs the bots

OpenCrewBot doesn't build its own agent loop. Each bot gets a Mastra [`AgentController`](https://mastra.ai/docs/harness/agent-controller), and each conversation gets its own session. Mastra handles the model calls, thread history, tool approvals and question pauses. OpenCrewBot folds the controller's events into chat messages and streams them to the browser over one SSE connection.

![Diagram](/public/image.png)

All keys stay on the server. Without Nebius or configured OpenAI-compatible model credentials, bots run on a scripted mock model that streams replies and exercises supported tools, so you can try the interface before configuring a provider.

## Get started

Use **Node.js 22.13 or newer** (developed on 24) and **pnpm**:

```sh
git clone https://github.com/Studio1-OSS/OpenCrewBot.git
cd OpenCrewBot
pnpm install
cp .env.example .env
pnpm dev
```

Open **http://localhost:3000**. On first run OpenCrewBot seeds eight agents and four collaboration rooms, including Scout (research), Quill (writing), Atlas (planning), and Studio.

Add your keys to `.env`, then restart `pnpm dev`. Every key is optional:

| Variable | What it turns on |
| --- | --- |
| `NEBIUS_API_KEY` | Real models from [Nebius Token Factory](https://tokenfactory.nebius.com). Without either this or a compatible provider, bots use the mock model. |
| `OPENCREWBOT_OPENAI_COMPATIBLE_BASE_URL` | Optional OpenAI-compatible API endpoint. |
| `OPENCREWBOT_OPENAI_COMPATIBLE_API_KEY` | API key for the compatible endpoint. |
| `OPENCREWBOT_OPENAI_COMPATIBLE_PROVIDER_ID` | Optional provider prefix (default `openai-compatible`). |
| `OPENCREWBOT_OPENAI_COMPATIBLE_MODELS` | Comma-separated model IDs exposed by the compatible endpoint. |
| `CRON_SECRET` | Secret required by the authenticated scheduled-workflow trigger. Set it on the app and scheduler worker. |
| `OPENCREWBOT_URL` | Optional base URL used by the standalone scheduler worker (default `http://127.0.0.1:3000`). |
| `SCHEDULER_INTERVAL_MS` | Optional polling interval for the standalone scheduler worker in milliseconds (default `30000`). |
| `TAVILY_API_KEY` | Web search, page reading and site crawls. |
| `BROWSERBASE_API_KEY` | Cloud browsers for bots with the Browser tool. |
| `BROWSERBASE_PROJECT_ID` | Optional. Inferred from the key when empty. |
| `BROWSERBASE_SESSION_MINUTES` | Optional cap on one browser session (default 15). |
| `COMPOSIO_API_KEY` | Connected apps (Slack, GitHub, Gmail, Notion and more) through [Composio](https://platform.composio.dev). |
| `TYPESAFE_API_KEY` | Jev routing in Auto rooms. Without it, the room's lead answers. |
| `JEV_MODEL` | Jev model id (default `jev-latest`). |
| `OPENCREWBOT_DATA_DIR` | Where data lives (default `./data`). |
| `OPENCREWBOT_ALLOWED_HOSTS` | Extra host names the API answers to, comma-separated. Only for deliberate setups behind your own sign-in. |

**No keys yet?** Try these in a bot's chat in mock mode:

- `remember that I like short answers` calls the memory tool and writes to `MEMORY.md`.
- `ask me something` shows a question card and resumes when you answer.
- `open https://example.com` shows an approval card first, in a bot with the Browser tool on.
- `search for Nebius Token Factory` runs a real Tavily search once `TAVILY_API_KEY` is set.

### Scheduled workflow runner

The app starts an in-process scheduler when its server service boots. To run a separate scheduler worker, configure the same `CRON_SECRET` on the app and worker, start the app, then run this in another terminal:

```sh
pnpm scheduler
```

The worker polls the authenticated `POST /api/workflows/cron` endpoint at the configured interval. The database lease helps prevent duplicate triggers if more than one scheduler is running. The standalone script is still a process that must remain running; for production, supervise it with your process manager and monitor failures. It does not provide a hosted queue or guaranteed catch-up of every missed run.

## Data and privacy

Bots, rooms and the chat transcript are stored in SQLite at `data/opencrewbot.db`. Mastra keeps each bot's model-side thread history in `data/mastra.db`. Each bot's memory is `data/workspaces/<botId>/MEMORY.md`. Nothing leaves your machine except calls to the services you configure:

- **Nebius Token Factory** receives each bot's system prompt (including its `MEMORY.md`), the conversation, and tool results.
- **Tavily** receives search queries and the URLs a bot reads or crawls.
- **Browserbase** runs the cloud browser, so it sees the pages a bot visits and anything typed into them. Sessions are released when a bot is reset or deleted, and expire after `BROWSERBASE_SESSION_MINUTES`.
- **Jev** receives the room name, member names and descriptions, the last few room messages and the new message, when an Auto room has no @mention.
- **Composio** holds the sign-ins for apps you connect, and receives the actions a bot runs in them.
- **Your MCP servers** receive the tool calls a bot makes to them. Their URLs and tokens are stored in `data/opencrewbot.db`.

OpenCrewBot sends no telemetry of its own. Review the privacy policy and retention settings of each service you connect.

It assumes one local owner and has no sign-in. To keep it that way, `pnpm dev` and `pnpm start` listen on `127.0.0.1` only, and the API refuses requests from other websites and requests addressed to any host but `localhost`. Don't expose it to the internet as-is.

## Features

| Area | Included |
| --- | --- |
| Bots | Eight seeded agents, live-model-generated agent definitions, role, instructions, model, tools and approval level; pin, search, unread counts, live typing status |
| Models | Nebius and configured OpenAI-compatible models; fallback candidates for execution tasks; switch without a restart; tokens and cost on replies |
| Connections | Composio apps with one-click sign-in, your own MCP servers (GitHub preset), per-bot access, approval for actions |
| Chat | Streaming Markdown, reasoning, tool steps with sources, Stop, and messages queued while a bot is busy |
| Rooms | Four seeded rooms, @mentions, `@everyone`, Auto routing with Jev, parallel responses, hand-offs, collaboration records, and a bounded peer-review step |
| Memory | Per-agent `MEMORY.md`, plus shared user, project and room memory; editable in the app, with secret redaction |
| Approvals | Central approval records, Allow once / Always allow / Deny, expiration, and ask-you question cards |
| Execution | Chief of Staff planning, task dependencies, parallel ready tasks, retries, cancellation, recovery, task/run history |
| Skills | Eight seeded reusable skills, text-based skill selection, and built-in capability provisioning |
| Workflows | Workflow templates, manual runs, UTC cron schedules, in-process scheduler and authenticated standalone scheduler worker |
| Browser | Browserbase session per bot, embedded live view with takeover, release on reset |
| Code mode | Multi-tool TypeScript in a QuickJS sandbox with no filesystem or network access |
| Mock mode | A scripted model that exercises supported tools, approvals and streaming without model credentials |

**Current limitations.** Planner fallback uses the configured specialist roster rather than regenerating a plan. Agent generation needs a working model provider; skill definitions are seeded and selection is text-based. Peer review depends on model output and is not a deterministic fact-check. The scheduler worker must remain running, and the app is single-user with no sign-in; keep it on localhost unless you add authentication and deployment protections. Composio, Browserbase, Jev and other live integrations require credentials and separate live verification. The seven assignment business demonstrations have not all been documented as end-to-end acceptance tests.

**Verification.** Run `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm test:unit`. `pnpm test:smoke` requires the app to be running at `http://127.0.0.1:3000` (or set `OPENCREWBOT_TEST_URL`). Unit tests cover cron parsing, retry/cancellation policies, interrupted-task recovery, ready-task selection, controlled access, skill matching, review parsing, and cron-auth decision cases. The cron-auth test exercises policy logic, not the HTTP route itself. Mock tests do not prove external integrations work. In the current checkout, `pnpm build` compiles and generates routes, but Next.js stops the command afterward with a security-version warning; the dependency has not been upgraded.

### Extending it

- Let Jev pick the model for each message (fast for simple asks, strong for hard ones). It's shown as "coming soon" in the model sheet.
- Let you talk to bots from Slack or Discord with Mastra Channels.
- Add sign-in and multiple users before deploying it anywhere shared.
- Add a durable queue and missed-run recovery for deployments that need stronger scheduling guarantees.
- Add live integration acceptance tests and record the seven required business demonstrations.
- Add voice: speak to a bot and have it read replies aloud.

## Project layout

- `src/lib/server/runtime.ts`: the harness glue. One `AgentController` per bot, one session per conversation, events folded into chat messages.
- `src/lib/server/tools.ts`: which tools a bot gets, their approval categories, and how each looks in chat.
- `src/lib/server/rooms.ts` and `jev.ts`: room routing, catch-up context and hand-offs.
- `src/lib/server/memory-files.ts`: `MEMORY.md` reads, writes, edits and redaction.
- `src/lib/server/browserbase.ts`: creates, announces and releases each bot's Browserbase session.
- `src/lib/server/mock-model.ts`: the scripted model used without a Nebius key.
- `src/components/`: the chat interface. `src/lib/client/store.ts` folds server events into state.

## Contributing

Issues and pull requests are welcome. Describe the workflow a change enables, run `pnpm exec tsc --noEmit` and `pnpm lint`, and say whether you tested it against live services or the mock model.

## License

[MIT](LICENSE) © 2026 Studio1HQ
