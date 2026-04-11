/**
 * Shared constants for the Claw Code adapter.
 */

/** Adapter type identifier registered with Paperclip. */
export const ADAPTER_TYPE = "claw_local";

/** Human-readable label shown in the Paperclip UI. */
export const ADAPTER_LABEL = "Claw Code";

/** Default CLI binary name. */
export const CLAW_CLI = "claw";

/** Default timeout for a single execution run (seconds). */
export const DEFAULT_TIMEOUT_SEC = 300;

/** Maximum allowed foreground timeout (seconds). Values above this are rejected. */
export const MAX_FOREGROUND_TIMEOUT_SEC = 3600;

/** Grace period after SIGTERM before SIGKILL (seconds). */
export const DEFAULT_GRACE_SEC = 10;

/** Default model (Claw Code uses Anthropic models by default). */
export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/**
 * Model-name prefix to provider hint mapping.
 * Claw Code primarily targets Anthropic models but supports
 * OpenAI-compatible endpoints via OPENAI_BASE_URL.
 */
export const MODEL_PREFIX_PROVIDER_HINTS: Array<[string, string]> = [
  ["claude", "anthropic"],
  ["gpt-4", "openai"],
  ["gpt-5", "openai"],
  ["o1-", "openai"],
  ["o3-", "openai"],
  ["o4-", "openai"],
  ["gemini", "google"],
  ["deepseek", "openai-compatible"],
];

/** Regex to extract session ID from Claw Code output. */
export const SESSION_ID_REGEX = /session[:\s]+([a-zA-Z0-9_-]+)/i;

/** Regex to extract token usage from Claw Code output. */
export const TOKEN_USAGE_REGEX =
  /(\d[\d,]*)\s*(?:input|prompt)\s*(?:tokens?).*?(\d[\d,]*)\s*(?:output|completion)\s*(?:tokens?)/i;

/** Regex to extract cost from Claw Code output. */
export const COST_REGEX = /(?:cost|total)[:\s]*\$?([\d.]+)/i;
