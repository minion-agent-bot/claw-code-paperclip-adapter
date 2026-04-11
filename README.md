# claw-code-paperclip-adapter

Paperclip adapter for [Claw Code](https://github.com/ultraworkers/claw-code) -- run Claw Code as a managed employee in a [Paperclip](https://paperclip.ing) company.

Claw Code is a Rust-based CLI agent harness by UltraWorkers. This adapter bridges it into the Paperclip orchestration layer so you can assign tasks, track heartbeats, and manage sessions just like any other Paperclip-managed agent.

## Prerequisites

- **Node.js** >= 20
- **Rust toolchain** (rustup) -- needed to build Claw Code from source
- **Claw Code** built and in PATH:
  ```bash
  git clone https://github.com/ultraworkers/claw-code
  cd claw-code && cargo build --workspace
  ```
- **ANTHROPIC_API_KEY** set in environment (or OPENAI_API_KEY + OPENAI_BASE_URL for compatible endpoints)

## Installation

```bash
npm install claw-code-paperclip-adapter
```

## Usage

Register the adapter in your Paperclip server configuration:

```json
{
  "adapterType": "claw_local",
  "adapterConfig": {
    "model": "claude-sonnet-4-20250514",
    "timeoutSec": 300,
    "persistSession": true
  }
}
```

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | `claude-sonnet-4-20250514` | Model ID to use |
| `timeoutSec` | number | `300` | Execution timeout in seconds (max: 3600) |
| `graceSec` | number | `10` | Grace period after SIGTERM before SIGKILL |
| `persistSession` | boolean | `true` | Resume sessions across heartbeats |
| `clawCommand` | string | `claw` | Path to the claw CLI binary |
| `extraArgs` | string[] | `[]` | Additional CLI arguments |
| `env` | object | `{}` | Extra environment variables |
| `promptTemplate` | string | _(built-in)_ | Custom prompt template with `{{variable}}` placeholders |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes (for Anthropic models) | Anthropic API key |
| `OPENAI_BASE_URL` | No | Override for OpenAI-compatible endpoints |
| `OPENAI_API_KEY` | Conditional | Required when using `OPENAI_BASE_URL` |

## Architecture

```
claw-code-paperclip-adapter
  ├── src/
  │   ├── index.ts              # Client-side exports (type, label, models, docs)
  │   ├── server/
  │   │   ├── index.ts          # Server module exports + sessionCodec
  │   │   ├── execute.ts        # Subprocess spawn, prompt building, output parsing
  │   │   ├── test.ts           # testEnvironment() -- claw doctor pre-flight
  │   │   └── detect-model.ts   # ~/.claw/config parsing, provider inference
  │   └── shared/
  │       └── constants.ts      # CLI defaults, regex patterns, provider hints
  └── dist/                     # Compiled output (ESM)
```

The adapter implements the `ServerAdapterModule` interface from `@paperclipai/adapter-utils`:

- **`execute(ctx)`** -- Spawns `claw -p "<prompt>" --model <model> --output-format json --dangerously-skip-permissions --no-banner`, with session resume via `--resume` and structured output parsing
- **`testEnvironment(ctx)`** -- Runs `claw doctor` pre-flight, checks CLI version, Rust toolchain, and API key availability
- **`detectModel()`** -- Reads `~/.claw/config` for model/provider settings with prefix-based inference fallback
- **`sessionCodec`** -- Cross-heartbeat session persistence via `--resume <sessionId>`

## Template Variables

Custom prompt templates support these placeholders:

| Variable | Description |
|----------|-------------|
| `{{agentId}}` | Paperclip agent ID |
| `{{agentName}}` | Agent display name |
| `{{companyId}}` | Paperclip company ID |
| `{{runId}}` | Current heartbeat run ID |
| `{{taskId}}` | Current task/issue ID |
| `{{taskTitle}}` | Task title |
| `{{taskBody}}` | Task description |
| `{{projectName}}` | Project name |

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm run typecheck    # Type-check only
npm run dev          # Watch mode
```

## License

MIT
