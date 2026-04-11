/**
 * Claw Code adapter for Paperclip.
 *
 * Runs Claw Code (https://github.com/ultraworkers/claw-code)
 * as a managed employee in a Paperclip company. Claw Code is a
 * Rust-based CLI agent harness — the fastest repo to 100K stars.
 *
 * @packageDocumentation
 */

export const type = "claw_local";
export const label = "Claw Code";

/**
 * Models available through Claw Code.
 *
 * Claw Code supports Anthropic models natively and OpenAI-compatible
 * endpoints via OPENAI_BASE_URL. The Paperclip UI should prefer
 * detectModel() plus manual entry over this curated list.
 */
export const models = [
  { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-sonnet-4-20250514-fast", label: "Claude Sonnet 4 (Fast)" },
];

/**
 * Documentation shown in the Paperclip UI when configuring a Claw Code agent.
 */
export const agentConfigurationDoc = `# Claw Code Configuration

Claw Code is a Rust-based CLI agent harness by UltraWorkers — a fast,
open-source alternative to Claude Code.

## Prerequisites

- Rust toolchain installed (rustup)
- Claw Code built from source: \`git clone https://github.com/ultraworkers/claw-code && cd claw-code && cargo build --workspace\`
- The \`claw\` binary must be in PATH
- ANTHROPIC_API_KEY configured in environment

## Core Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| model | string | claude-sonnet-4-20250514 | Model ID to use |
| timeoutSec | number | 300 | Execution timeout in seconds (max: 3600; values above this are rejected) |
| graceSec | number | 10 | Grace period after SIGTERM before SIGKILL |

## Session & Workspace

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| persistSession | boolean | true | Resume sessions across heartbeats |

## Advanced

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| clawCommand | string | claw | Path to claw CLI binary |
| extraArgs | string[] | [] | Additional CLI arguments |
| env | object | {} | Extra environment variables |
| promptTemplate | string | (default) | Custom prompt template with {{variable}} placeholders |

## Environment Variables

- \`ANTHROPIC_API_KEY\` — Required for Anthropic models
- \`OPENAI_BASE_URL\` — Override to use OpenAI-compatible endpoints
- \`OPENAI_API_KEY\` — Required when using OPENAI_BASE_URL

## Available Template Variables

- \`{{agentId}}\` — Paperclip agent ID
- \`{{agentName}}\` — Agent display name
- \`{{companyId}}\` — Paperclip company ID
- \`{{runId}}\` — Current heartbeat run ID
- \`{{taskId}}\` — Current task/issue ID (if assigned)
- \`{{taskTitle}}\` — Task title (if assigned)
- \`{{taskBody}}\` — Task description (if assigned)
- \`{{projectName}}\` — Project name (if scoped to a project)
`;
