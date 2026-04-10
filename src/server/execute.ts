/**
 * Server-side execution logic for the Claw Code adapter.
 *
 * Spawns `claw` as a child process in non-interactive mode,
 * streams output, and returns structured results to Paperclip.
 *
 * Claw Code CLI surface (claw --help):
 *   -p / --prompt        single prompt (non-interactive)
 *   --model              model ID
 *   --resume             resume session by ID
 *   --output-format      output format (text, json, stream-json)
 *   --max-turns          max agentic turns
 *   --allowedTools       comma-separated tool list
 *   --dangerously-skip-permissions  bypass permission prompts (agents have no TTY)
 *   --no-banner          suppress startup banner
 *   --verbose            verbose output
 */
import {
  runChildProcess,
  buildPaperclipEnv,
  renderTemplate,
  ensureAbsoluteDirectory,
} from "@paperclipai/adapter-utils/server-utils";
import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import {
  CLAW_CLI,
  DEFAULT_TIMEOUT_SEC,
  DEFAULT_GRACE_SEC,
  DEFAULT_MODEL,
  SESSION_ID_REGEX,
  TOKEN_USAGE_REGEX,
  COST_REGEX,
} from "../shared/constants.js";
import { detectModel, inferProviderFromModel } from "./detect-model.js";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function cfgString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function cfgNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function cfgBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function cfgStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((i) => typeof i === "string")
    ? (v as string[])
    : undefined;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

const DEFAULT_PROMPT_TEMPLATE = `You are "{{agentName}}", an AI agent employee in a Paperclip-managed company.

IMPORTANT: Use your tools with \`curl\` for ALL Paperclip API calls.

Your Paperclip identity:
  Agent ID: {{agentId}}
  Company ID: {{companyId}}
  API Base: {{paperclipApiUrl}}

{{#taskId}}
## Assigned Task

Issue ID: {{taskId}}
Title: {{taskTitle}}

{{taskBody}}

## Workflow

1. Work on the task using your tools
2. When done, mark the issue as completed:
   \`curl -s -X PATCH "{{paperclipApiUrl}}/issues/{{taskId}}" -H "Content-Type: application/json" -d '{"status":"done"}'\`
3. Post a completion comment summarizing what you did:
   \`curl -s -X POST "{{paperclipApiUrl}}/issues/{{taskId}}/comments" -H "Content-Type: application/json" -d '{"body":"DONE: <summary>"}'\`
{{/taskId}}

{{#commentId}}
## Comment on This Issue

Someone commented. Read it:
   \`curl -s "{{paperclipApiUrl}}/issues/{{taskId}}/comments/{{commentId}}"\`

Address the comment, POST a reply if needed, then continue working.
{{/commentId}}

{{#noTask}}
## Heartbeat Wake — Check for Work

1. List open issues assigned to you:
   \`curl -s "{{paperclipApiUrl}}/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}&status=todo,in_progress"\`

2. If issues found, pick the highest priority one and work on it.

3. If nothing to do, report briefly what you checked.
{{/noTask}}`;

function buildPrompt(
  ctx: AdapterExecutionContext,
  config: Record<string, unknown>,
): string {
  const template = cfgString(config.promptTemplate) || DEFAULT_PROMPT_TEMPLATE;
  const taskId = cfgString((ctx.config as Record<string, unknown>)?.taskId);
  const taskTitle =
    cfgString((ctx.config as Record<string, unknown>)?.taskTitle) || "";
  const taskBody =
    cfgString((ctx.config as Record<string, unknown>)?.taskBody) || "";
  const commentId =
    cfgString((ctx.config as Record<string, unknown>)?.commentId) || "";
  const agentName = ctx.agent?.name || "Claw Code Agent";
  const projectName =
    cfgString((ctx.config as Record<string, unknown>)?.projectName) || "";

  let paperclipApiUrl =
    cfgString(config.paperclipApiUrl) ||
    process.env.PAPERCLIP_API_URL ||
    "http://127.0.0.1:3100/api";
  if (!paperclipApiUrl.endsWith("/api")) {
    paperclipApiUrl = paperclipApiUrl.replace(/\/+$/, "") + "/api";
  }

  const vars: Record<string, string> = {
    agentId: ctx.agent?.id || "",
    agentName,
    companyId: ctx.agent?.companyId || "",
    runId: ctx.runId || "",
    taskId: taskId || "",
    taskTitle,
    taskBody,
    commentId,
    projectName,
    paperclipApiUrl,
  };

  let rendered = template;
  rendered = rendered.replace(
    /\{\{#taskId\}\}([\s\S]*?)\{\{\/taskId\}\}/g,
    taskId ? "$1" : "",
  );
  rendered = rendered.replace(
    /\{\{#noTask\}\}([\s\S]*?)\{\{\/noTask\}\}/g,
    taskId ? "" : "$1",
  );
  rendered = rendered.replace(
    /\{\{#commentId\}\}([\s\S]*?)\{\{\/commentId\}\}/g,
    commentId ? "$1" : "",
  );

  return renderTemplate(rendered, vars);
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

interface ParsedOutput {
  sessionId?: string;
  response?: string;
  usage?: { inputTokens: number; outputTokens: number };
  costUsd?: number;
  errorMessage?: string;
  model?: string;
}

/**
 * Parse JSON-formatted output from Claw Code when using --output-format json.
 */
function tryParseJsonOutput(stdout: string): ParsedOutput | null {
  try {
    const lastBrace = stdout.lastIndexOf("}");
    if (lastBrace === -1) return null;
    const firstBrace = stdout.lastIndexOf("{", lastBrace);
    if (firstBrace === -1) return null;

    const jsonStr = stdout.slice(firstBrace, lastBrace + 1);
    const data = JSON.parse(jsonStr) as Record<string, unknown>;

    const result: ParsedOutput = {};
    if (typeof data.session_id === "string") result.sessionId = data.session_id;
    if (typeof data.result === "string") result.response = data.result;
    if (typeof data.model === "string") result.model = data.model;

    const usage = data.usage as Record<string, unknown> | undefined;
    if (usage) {
      result.usage = {
        inputTokens: Number(usage.input_tokens ?? usage.inputTokens ?? 0),
        outputTokens: Number(usage.output_tokens ?? usage.outputTokens ?? 0),
      };
    }
    if (typeof data.cost_usd === "number") result.costUsd = data.cost_usd;
    if (typeof data.total_cost === "number") result.costUsd = data.total_cost;

    return result;
  } catch {
    return null;
  }
}

/**
 * Parse text-formatted output from Claw Code.
 */
function parseTextOutput(stdout: string, stderr: string): ParsedOutput {
  const combined = stdout + "\n" + stderr;
  const result: ParsedOutput = {};

  // Extract session ID
  const sessionMatch = stdout.match(SESSION_ID_REGEX);
  if (sessionMatch?.[1]) {
    result.sessionId = sessionMatch[1];
  }

  // Extract token usage
  const usageMatch = combined.match(TOKEN_USAGE_REGEX);
  if (usageMatch) {
    result.usage = {
      inputTokens: parseInt(usageMatch[1].replace(/,/g, ""), 10) || 0,
      outputTokens: parseInt(usageMatch[2].replace(/,/g, ""), 10) || 0,
    };
  }

  // Extract cost
  const costMatch = combined.match(COST_REGEX);
  if (costMatch?.[1]) {
    result.costUsd = parseFloat(costMatch[1]);
  }

  // Clean response: filter out noise lines
  const cleaned = stdout
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (t.startsWith("[system]") || t.startsWith("[debug]")) return false;
      if (/^session[:\s]/i.test(t)) return false;
      if (/^\[\d{4}-\d{2}-\d{2}T/.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length > 0) {
    result.response = cleaned;
  }

  // Check stderr for errors
  if (stderr.trim()) {
    const errorLines = stderr
      .split("\n")
      .filter((line) => /error|exception|panic|failed/i.test(line))
      .filter((line) => !/INFO|DEBUG|warn|WARN/i.test(line));
    if (errorLines.length > 0) {
      result.errorMessage = errorLines.slice(0, 5).join("\n");
    }
  }

  return result;
}

function parseClawOutput(stdout: string, stderr: string): ParsedOutput {
  // Try JSON output first (if --output-format json was used)
  const jsonResult = tryParseJsonOutput(stdout);
  if (jsonResult) return jsonResult;

  // Fall back to text parsing
  return parseTextOutput(stdout, stderr);
}

// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------

export async function execute(
  ctx: AdapterExecutionContext,
): Promise<AdapterExecutionResult> {
  const config = (ctx.agent?.adapterConfig ?? {}) as Record<string, unknown>;

  // ── Resolve configuration ───────────────────────────────────────────
  const clawCmd = cfgString(config.clawCommand) || CLAW_CLI;
  const model = cfgString(config.model) || DEFAULT_MODEL;
  const timeoutSec = cfgNumber(config.timeoutSec) || DEFAULT_TIMEOUT_SEC;
  const graceSec = cfgNumber(config.graceSec) || DEFAULT_GRACE_SEC;
  const extraArgs = cfgStringArray(config.extraArgs);
  const persistSession = cfgBoolean(config.persistSession) !== false;
  const maxTurns = cfgNumber(config.maxTurns);

  // ── Build prompt ────────────────────────────────────────────────────
  const prompt = buildPrompt(ctx, config);

  // ── Build command args ──────────────────────────────────────────────
  // Claw Code CLI: claw -p "prompt" --model <model> --no-banner
  const args: string[] = [
    "-p",
    prompt,
    "--model",
    model,
    "--output-format",
    "json",
    "--dangerously-skip-permissions",
  ];

  // Suppress banner in non-interactive mode
  args.push("--no-banner");

  // Max turns
  if (maxTurns) {
    args.push("--max-turns", String(maxTurns));
  }

  // Session resume
  const prevSessionId = cfgString(
    (ctx.runtime?.sessionParams as Record<string, unknown> | null)?.sessionId,
  );
  if (persistSession && prevSessionId) {
    args.push("--resume", prevSessionId);
  }

  if (extraArgs?.length) {
    args.push(...extraArgs);
  }

  // ── Build environment ───────────────────────────────────────────────
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...buildPaperclipEnv(ctx.agent),
  };

  if (ctx.runId) env.PAPERCLIP_RUN_ID = ctx.runId;

  const taskId = cfgString(
    (ctx.config as Record<string, unknown>)?.taskId,
  );
  if (taskId) env.PAPERCLIP_TASK_ID = taskId;

  const userEnv = config.env;
  if (userEnv && typeof userEnv === "object") {
    Object.assign(env, userEnv);
  }

  // ── Resolve working directory ───────────────────────────────────────
  const cwd =
    cfgString(config.cwd) ||
    cfgString((ctx.config as Record<string, unknown>)?.workspaceDir) ||
    ".";
  try {
    await ensureAbsoluteDirectory(cwd);
  } catch {
    // Non-fatal
  }

  // ── Detect provider for logging ─────────────────────────────────────
  let detectedProvider = "anthropic";
  try {
    const detected = await detectModel();
    if (detected?.provider) detectedProvider = detected.provider;
  } catch {
    // Non-fatal
  }
  const provider = inferProviderFromModel(model) ?? detectedProvider;

  // ── Log start ───────────────────────────────────────────────────────
  await ctx.onLog(
    "stdout",
    `[claw] Starting Claw Code (model=${model}, timeout=${timeoutSec}s)\n`,
  );
  if (prevSessionId) {
    await ctx.onLog("stdout", `[claw] Resuming session: ${prevSessionId}\n`);
  }

  // ── Execute ─────────────────────────────────────────────────────────
  // Reclassify benign stderr lines as stdout
  const wrappedOnLog: typeof ctx.onLog = async (stream, chunk) => {
    if (stream === "stderr") {
      const trimmed = chunk.trimEnd();
      const isBenign =
        /^\[?\d{4}[-/]\d{2}[-/]\d{2}T/.test(trimmed) ||
        /^(INFO|DEBUG|WARN|TRACE)\b/.test(trimmed) ||
        /Compiling|Finished|Running/.test(trimmed);
      if (isBenign) {
        return ctx.onLog("stdout", chunk);
      }
    }
    return ctx.onLog(stream, chunk);
  };

  const result = await runChildProcess(ctx.runId, clawCmd, args, {
    cwd,
    env,
    timeoutSec,
    graceSec,
    onLog: wrappedOnLog,
  });

  // ── Parse output ────────────────────────────────────────────────────
  const parsed = parseClawOutput(result.stdout || "", result.stderr || "");

  await ctx.onLog(
    "stdout",
    `[claw] Exit code: ${result.exitCode ?? "null"}, timed out: ${result.timedOut}\n`,
  );
  if (parsed.sessionId) {
    await ctx.onLog("stdout", `[claw] Session: ${parsed.sessionId}\n`);
  }

  // ── Build result ────────────────────────────────────────────────────
  const executionResult: AdapterExecutionResult = {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    provider,
    model: parsed.model || model,
  };

  if (parsed.errorMessage) {
    executionResult.errorMessage = parsed.errorMessage;
  }

  if (parsed.usage) {
    executionResult.usage = parsed.usage;
  }

  if (parsed.costUsd !== undefined) {
    executionResult.costUsd = parsed.costUsd;
  }

  if (parsed.response) {
    executionResult.summary = parsed.response.slice(0, 2000);
  }

  executionResult.resultJson = {
    result: parsed.response || "",
    session_id: parsed.sessionId || null,
    usage: parsed.usage || null,
    cost_usd: parsed.costUsd ?? null,
  };

  // Store session for next heartbeat
  if (persistSession && parsed.sessionId) {
    executionResult.sessionParams = { sessionId: parsed.sessionId };
    executionResult.sessionDisplayId = parsed.sessionId.slice(0, 16);
  }

  return executionResult;
}
