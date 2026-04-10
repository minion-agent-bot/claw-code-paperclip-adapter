/**
 * Detect the current model from the user's Claw Code config.
 *
 * Reads ~/.claw/config (TOML-like) and extracts the model setting.
 * Also provides provider inference from model name prefixes.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { MODEL_PREFIX_PROVIDER_HINTS } from "../shared/constants.js";

export interface DetectedModelConfig {
  model: string;
  provider: string;
  source: string;
}

/**
 * Read the Claw Code config and extract model settings.
 *
 * Claw Code stores config in ~/.claw/config (TOML-like format).
 * We parse it with simple regex to avoid a TOML dependency.
 */
export async function detectModel(
  configPath?: string,
): Promise<DetectedModelConfig | null> {
  const candidates = configPath
    ? [configPath]
    : [
        join(homedir(), ".claw", "config"),
        join(homedir(), ".claw", "config.toml"),
        join(homedir(), ".config", "claw", "config.toml"),
      ];

  let content: string | null = null;
  for (const candidate of candidates) {
    try {
      content = await readFile(candidate, "utf-8");
      break;
    } catch {
      continue;
    }
  }

  if (!content) return null;
  return parseModelFromConfig(content);
}

/**
 * Parse model from Claw Code config content.
 *
 * Claw Code config may contain lines like:
 *   model = "claude-sonnet-4-20250514"
 *   model_provider = "anthropic"
 *   api_key_source = "env"
 */
export function parseModelFromConfig(
  content: string,
): DetectedModelConfig | null {
  const lines = content.split("\n");
  let model = "";
  let provider = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;

    // Match key = "value" or key = 'value' or key = value
    const match = trimmed.match(
      /^(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/,
    );
    if (!match) continue;

    const key = match[1];
    const val = match[2] ?? match[3] ?? match[4] ?? "";

    if (key === "model" || key === "default_model") model = val;
    if (key === "model_provider" || key === "provider") provider = val;
  }

  if (!model) return null;

  if (!provider) {
    provider = inferProviderFromModel(model) ?? "anthropic";
  }

  return { model, provider, source: "config" };
}

/**
 * Infer a provider from the model name using prefix-based hints.
 */
export function inferProviderFromModel(model: string): string | undefined {
  const lower = model.toLowerCase();
  const bareName = lower.includes("/") ? lower.split("/").pop()! : lower;

  for (const [prefix, hint] of MODEL_PREFIX_PROVIDER_HINTS) {
    if (bareName.startsWith(prefix)) {
      return hint;
    }
  }

  return undefined;
}
