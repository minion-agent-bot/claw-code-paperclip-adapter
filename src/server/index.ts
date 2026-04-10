/**
 * Server-side adapter module exports.
 */
export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export {
  detectModel,
  parseModelFromConfig,
  inferProviderFromModel,
} from "./detect-model.js";

import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

/**
 * Session codec for structured validation of session parameters.
 *
 * Claw Code uses a session ID for cross-heartbeat continuity
 * via the `--resume` CLI flag.
 */
export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.sessionId !== "string") return null;
    return { sessionId: obj.sessionId };
  },

  serialize(
    params: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!params?.sessionId) return null;
    return { sessionId: String(params.sessionId) };
  },

  getDisplayId(params: Record<string, unknown> | null): string | null {
    if (!params?.sessionId) return null;
    return String(params.sessionId).slice(0, 16);
  },
};
