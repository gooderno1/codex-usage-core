import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { EnvHttpProxyAgent, request } from "undici";
import type {
  CodexAccountRateLimitsSnapshot,
  CodexCreditsSnapshot,
  CodexRateLimitResetCreditsSummary,
  CodexRateLimitSnapshot,
  CodexRateLimitWindowSnapshot,
  CodexUsageRateLimitsReadOptions
} from "./contracts.js";

const DEFAULT_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const DEFAULT_TIMEOUT_MS = 20_000;
const SECONDS_PER_MINUTE = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeUnixSeconds(value: unknown) {
  const seconds = numberOrNull(value);
  return {
    iso: seconds === null ? null : new Date(seconds * 1000).toISOString(),
    seconds
  };
}

function normalizeWindow(raw: unknown): CodexRateLimitWindowSnapshot | null {
  if (!isRecord(raw)) {
    return null;
  }

  const usedPercent = numberOrNull(raw.used_percent);
  if (usedPercent === null) {
    return null;
  }

  const windowSeconds = numberOrNull(raw.limit_window_seconds);
  const resetsAt = normalizeUnixSeconds(raw.reset_at);
  return {
    usedPercent,
    windowDurationMins: windowSeconds === null ? null : windowSeconds / SECONDS_PER_MINUTE,
    resetsAt: resetsAt.iso,
    resetsAtUnixSeconds: resetsAt.seconds
  };
}

function normalizeCredits(raw: unknown): CodexCreditsSnapshot | null {
  if (!isRecord(raw) || typeof raw.has_credits !== "boolean" || typeof raw.unlimited !== "boolean") {
    return null;
  }

  return {
    hasCredits: raw.has_credits,
    unlimited: raw.unlimited,
    balance: stringOrNull(raw.balance)
  };
}

function normalizeReachedType(raw: unknown) {
  if (typeof raw === "string") {
    return raw;
  }
  return isRecord(raw) ? stringOrNull(raw.type) : null;
}

function normalizeRateLimitSnapshot(
  raw: unknown,
  planType: string | null,
  limitId: string,
  limitName: string | null,
  credits: CodexCreditsSnapshot | null,
  reachedType: string | null
): CodexRateLimitSnapshot {
  if (!isRecord(raw)) {
    throw new Error("Codex 官方用量响应缺少 rate_limit 对象");
  }

  return {
    limitId,
    limitName,
    planType,
    primary: normalizeWindow(raw.primary_window),
    secondary: normalizeWindow(raw.secondary_window),
    credits,
    rateLimitReachedType: reachedType
  };
}

function normalizeResetCredits(raw: unknown): CodexRateLimitResetCreditsSummary | null {
  if (!isRecord(raw)) {
    return null;
  }

  const availableCount = numberOrNull(raw.available_count);
  return availableCount === null ? null : { availableCount, credits: null };
}

function normalizeLimitKey(limitName: string, index: number) {
  const slug = limitName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `additional:${slug || index + 1}`;
}

export function normalizeCodexWhamUsageResult(
  result: unknown,
  observedAt = new Date().toISOString()
): CodexAccountRateLimitsSnapshot {
  if (!isRecord(result)) {
    throw new Error("Codex 官方用量响应不是对象");
  }

  const planType = stringOrNull(result.plan_type);
  const baseLimitName = stringOrNull(result.rate_limit_name);
  const credits = normalizeCredits(result.credits);
  const reachedType = normalizeReachedType(result.rate_limit_reached_type);
  const rateLimits = normalizeRateLimitSnapshot(
    result.rate_limit,
    planType,
    "codex",
    baseLimitName,
    credits,
    reachedType
  );
  const rateLimitsByLimitId: Record<string, CodexRateLimitSnapshot> = {
    codex: rateLimits
  };

  if (Array.isArray(result.additional_rate_limits)) {
    result.additional_rate_limits.forEach((entry, index) => {
      if (!isRecord(entry) || !isRecord(entry.rate_limit)) {
        return;
      }
      const limitName = stringOrNull(entry.limit_name);
      if (!limitName?.trim()) {
        return;
      }
      const limitId = normalizeLimitKey(limitName, index);
      rateLimitsByLimitId[limitId] = normalizeRateLimitSnapshot(
        entry.rate_limit,
        planType,
        limitId,
        limitName,
        null,
        null
      );
    });
  }

  return {
    observedAt,
    source: "codex-wham-usage",
    rateLimitResetCredits: normalizeResetCredits(result.rate_limit_reset_credits),
    rateLimits,
    rateLimitsByLimitId
  };
}

interface CodexAuthTokens {
  accessToken: string;
  accountId: string;
}

async function readCodexAuthTokens(authPath: string): Promise<CodexAuthTokens> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(authPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `无法读取 Codex 登录状态：${error instanceof Error ? error.message : String(error)}`
    );
  }

  const tokens = isRecord(raw) && isRecord(raw.tokens) ? raw.tokens : null;
  const accessToken = tokens ? stringOrNull(tokens.access_token) : null;
  const accountId = tokens ? stringOrNull(tokens.account_id) : null;
  if (!accessToken || !accountId) {
    throw new Error("Codex 当前不是可读取官方用量的 ChatGPT 登录状态");
  }

  return { accessToken, accountId };
}

function resolveAuthPath(options: CodexUsageRateLimitsReadOptions) {
  if (options.authPath) {
    return options.authPath;
  }

  const codexHomeDirectory =
    options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  return join(codexHomeDirectory, "auth.json");
}

export async function readCodexUsageRateLimits(
  options: CodexUsageRateLimitsReadOptions = {}
): Promise<CodexAccountRateLimitsSnapshot> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const observedAt = options.observedAt ?? new Date().toISOString();
  const clientVersion = options.clientVersion ?? "0.0.0";
  const { accessToken, accountId } = await readCodexAuthTokens(resolveAuthPath(options));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const useEnvProxy =
    options.useEnvProxy ??
    Boolean(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy);
  const dispatcher = useEnvProxy ? new EnvHttpProxyAgent() : undefined;

  try {
    const response = await request(endpoint, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "chatgpt-account-id": accountId,
        accept: "application/json",
        "oai-language": "zh-CN",
        originator: "Codex Desktop",
        "user-agent": "codex-usage-core",
        "x-openai-codex-client-version": clientVersion
      },
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      signal: controller.signal,
      dispatcher
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      await response.body.dump();
      throw new Error(`Codex 官方用量接口返回 HTTP ${response.statusCode}`);
    }

    const result = JSON.parse(await response.body.text()) as unknown;
    return normalizeCodexWhamUsageResult(result, observedAt);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`读取 Codex 官方用量超时：${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    await dispatcher?.close();
  }
}
