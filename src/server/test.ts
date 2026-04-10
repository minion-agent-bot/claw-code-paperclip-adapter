/**
 * Environment test for the Claw Code adapter.
 *
 * Verifies that Claw Code is installed, accessible, and configured
 * before allowing the adapter to be used.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CLAW_CLI, ADAPTER_TYPE } from "../shared/constants.js";
import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterEnvironmentCheck,
} from "@paperclipai/adapter-utils";

const execFileAsync = promisify(execFile);

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkCliInstalled(
  command: string,
): Promise<AdapterEnvironmentCheck | null> {
  try {
    await execFileAsync(command, ["--version"], { timeout: 10_000 });
    return null;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return {
        level: "error",
        message: `Claw Code CLI "${command}" not found in PATH`,
        hint: "Build from source: git clone https://github.com/ultraworkers/claw-code && cd claw-code && cargo build --workspace",
        code: "claw_cli_not_found",
      };
    }
    return null;
  }
}

async function checkCliVersion(
  command: string,
): Promise<AdapterEnvironmentCheck | null> {
  try {
    const { stdout } = await execFileAsync(command, ["--version"], {
      timeout: 10_000,
    });
    const version = stdout.trim();
    if (version) {
      return {
        level: "info",
        message: `Claw Code version: ${version}`,
        code: "claw_version",
      };
    }
    return {
      level: "warn",
      message: "Could not determine Claw Code version",
      code: "claw_version_unknown",
    };
  } catch {
    return {
      level: "warn",
      message:
        "Could not determine Claw Code version (claw --version failed)",
      hint: "Make sure the claw CLI is properly built and in PATH",
      code: "claw_version_failed",
    };
  }
}

async function checkDoctor(
  command: string,
): Promise<AdapterEnvironmentCheck | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ["doctor"], {
      timeout: 15_000,
    });
    const output = (stdout + stderr).trim();
    const hasError =
      /error|fail|missing/i.test(output) && !/0 errors/i.test(output);
    if (hasError) {
      return {
        level: "warn",
        message: `claw doctor reported issues: ${output.slice(0, 200)}`,
        hint: "Run 'claw doctor' manually to see full diagnostics",
        code: "claw_doctor_issues",
      };
    }
    return {
      level: "info",
      message: "claw doctor: all checks passed",
      code: "claw_doctor_ok",
    };
  } catch {
    return {
      level: "warn",
      message: "claw doctor command failed or is not available",
      hint: "Ensure claw is up to date — doctor command may require a recent build",
      code: "claw_doctor_failed",
    };
  }
}

async function checkRustToolchain(): Promise<AdapterEnvironmentCheck | null> {
  try {
    const { stdout } = await execFileAsync("rustc", ["--version"], {
      timeout: 5_000,
    });
    return {
      level: "info",
      message: `Rust toolchain: ${stdout.trim()}`,
      code: "claw_rust_version",
    };
  } catch {
    return {
      level: "info",
      message:
        "Rust toolchain not found — not required if claw binary is pre-built",
      code: "claw_rust_missing",
    };
  }
}

function checkApiKeys(
  config: Record<string, unknown>,
): AdapterEnvironmentCheck {
  const envConfig = (config.env ?? {}) as Record<string, unknown>;
  const resolvedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string" && value.length > 0)
      resolvedEnv[key] = value;
  }

  const has = (key: string): boolean =>
    !!(resolvedEnv[key] ?? process.env[key]);

  const hasAnthropic = has("ANTHROPIC_API_KEY");
  const hasOpenAI = has("OPENAI_API_KEY");
  const hasOpenAIBase = has("OPENAI_BASE_URL");

  if (!hasAnthropic && !hasOpenAI) {
    return {
      level: "warn",
      message: "No LLM API keys found in environment",
      hint: "Set ANTHROPIC_API_KEY in the agent's env secrets. For OpenAI-compatible endpoints, set OPENAI_API_KEY and OPENAI_BASE_URL.",
      code: "claw_no_api_keys",
    };
  }

  const providers: string[] = [];
  if (hasAnthropic) providers.push("Anthropic");
  if (hasOpenAI) providers.push("OpenAI");
  if (hasOpenAIBase) providers.push("OpenAI-compatible endpoint");

  return {
    level: "info",
    message: `API keys found: ${providers.join(", ")}`,
    code: "claw_api_keys_found",
  };
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const config = (ctx.config ?? {}) as Record<string, unknown>;
  const command = asString(config.clawCommand) || CLAW_CLI;
  const checks: AdapterEnvironmentCheck[] = [];

  // 1. CLI installed?
  const cliCheck = await checkCliInstalled(command);
  if (cliCheck) {
    checks.push(cliCheck);
    if (cliCheck.level === "error") {
      return {
        adapterType: ADAPTER_TYPE,
        status: "fail",
        checks,
        testedAt: new Date().toISOString(),
      };
    }
  }

  // 2. CLI version
  const versionCheck = await checkCliVersion(command);
  if (versionCheck) checks.push(versionCheck);

  // 3. claw doctor pre-flight
  const doctorCheck = await checkDoctor(command);
  if (doctorCheck) checks.push(doctorCheck);

  // 4. Rust toolchain (informational)
  const rustCheck = await checkRustToolchain();
  if (rustCheck) checks.push(rustCheck);

  // 5. API keys
  const apiKeyCheck = checkApiKeys(config);
  checks.push(apiKeyCheck);

  const hasErrors = checks.some((c) => c.level === "error");
  const hasWarnings = checks.some((c) => c.level === "warn");

  return {
    adapterType: ADAPTER_TYPE,
    status: hasErrors ? "fail" : hasWarnings ? "warn" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  };
}
