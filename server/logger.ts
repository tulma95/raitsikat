// One structured logger for the whole server.
//
// - `logger` is the root; every component gets a child via
//   `logger.child({ component, mode, ... })`. Bindings travel into
//   every emitted line so grep/filter by component works.
// - Output is one record per line. JSON when stdout is piped (prod);
//   colorized single-line "pretty" when stdout is a TTY (dev).
//   Force either with LOG_FORMAT=json|pretty.
// - Level gate via LOG_LEVEL=debug|info|warn|error (default info).
// - Pass Errors under the `err` field so they're serialized with
//   name/message/stack instead of `{}`.

import { styleText } from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

interface LoggerConfig {
  minLevel: number;
  pretty: boolean;
  out: NodeJS.WritableStream;
}

function readConfig(): LoggerConfig {
  const lvlRaw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  const minLevel = (LEVELS as Record<string, number>)[lvlRaw] ?? LEVELS.info;
  const format = (process.env.LOG_FORMAT ?? "").toLowerCase();
  const isTty = Boolean((process.stdout as NodeJS.WriteStream).isTTY);
  const pretty = format === "pretty" || (format !== "json" && isTty);
  return { minLevel, pretty, out: process.stdout };
}

function serializeErr(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

function normalizeFields(
  fields?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = k === "err" ? serializeErr(v) : v;
  }
  return out;
}

const LEVEL_STYLE: Record<LogLevel, Parameters<typeof styleText>[0]> = {
  debug: "gray",
  info: "cyan",
  warn: "yellow",
  error: "red",
};

function renderFieldValue(k: string, v: unknown): string {
  if (k === "err" && v && typeof v === "object") {
    const err = v as Record<string, unknown>;
    return String(err.message ?? err.name ?? "");
  }
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatPretty(
  time: string,
  level: LogLevel,
  bindings: Record<string, unknown>,
  msg: string,
  fields: Record<string, unknown> | undefined,
): string {
  const ts = styleText("gray", time);
  const lvl = styleText(LEVEL_STYLE[level], level.toUpperCase().padEnd(5));
  const bindStr = Object.entries(bindings)
    .map(([k, v]) => styleText("dim", `${k}=${String(v)}`))
    .join(" ");
  const parts = [ts, lvl];
  if (bindStr) parts.push(bindStr);
  parts.push(msg);
  let line = parts.join(" ");
  if (fields && Object.keys(fields).length > 0) {
    const extra = Object.entries(fields)
      .map(([k, v]) => `${k}=${renderFieldValue(k, v)}`)
      .join(" ");
    line += " " + styleText("dim", extra);
  }
  return line;
}

function makeLogger(
  bindings: Record<string, unknown>,
  cfg: LoggerConfig,
): Logger {
  function emit(
    level: LogLevel,
    msg: string,
    fields?: Record<string, unknown>,
  ): void {
    if (LEVELS[level] < cfg.minLevel) return;
    const time = new Date().toISOString();
    const norm = normalizeFields(fields);
    let line: string;
    if (cfg.pretty) {
      line = formatPretty(time, level, bindings, msg, norm);
    } else {
      const record: Record<string, unknown> = { time, level, ...bindings, msg };
      if (norm) Object.assign(record, norm);
      line = JSON.stringify(record);
    }
    cfg.out.write(line + "\n");
  }
  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (extra) => makeLogger({ ...bindings, ...extra }, cfg),
  };
}

export const logger: Logger = makeLogger({}, readConfig());
