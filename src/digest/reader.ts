import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { DigestRow, EventStatusCounts, ReadNight, RunEvent } from './types.js';

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const instant = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date;
}

function validTimestamp(at: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-]([01]\d|2[0-3]):([0-5]\d))$/.exec(at);
  return match !== null && validDate(match[1]) && Number.isFinite(Date.parse(at));
}

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.at === 'string' && validTimestamp(event.at)
    && typeof event.job === 'string'
    && (event.owner === null || typeof event.owner === 'string')
    && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && (!Object.hasOwn(event, 'error') || typeof event.error === 'string');
}

function stringOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!validDate(night)) throw new RangeError('Night must be a valid YYYY-MM-DD identifier');

  let contents: string;
  try {
    const root = realpathSync(runsDir);
    const path = realpathSync(join(root, `${night}.jsonl`));
    const withinRoot = relative(root, path);
    if (isAbsolute(withinRoot) || withinRoot === '..' || withinRoot.startsWith('../')) {
      throw new RangeError('Night file must remain inside runsDir');
    }
    contents = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { kind: 'missing', night };
    }
    throw error;
  }

  const events: { event: RunEvent; instant: number; fraction: string; line: number }[] = [];
  let malformedLineCount = 0;
  for (const [line, text] of contents.split(/\r?\n/).entries()) {
    if (text.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      malformedLineCount++;
      continue;
    }
    if (!isRunEvent(value)) {
      malformedLineCount++;
      continue;
    }
    // Compare fractional seconds beyond Date's millisecond precision as well.
    const fraction = /\.(\d+)/.exec(value.at)?.[1].replace(/0+$/, '') ?? '';
    events.push({ event: value, instant: Date.parse(value.at), fraction, line });
  }
  events.sort((a, b) => a.instant - b.instant || stringOrder(a.fraction, b.fraction) || a.line - b.line);

  const rowsByJob = new Map<string, DigestRow>();
  const statusCounts: EventStatusCounts = { ok: 0, retry: 0, fail: 0 };
  for (const { event } of events) {
    statusCounts[event.status]++;
    const row = rowsByJob.get(event.job);
    if (row) {
      row.owner = event.owner;
      row.runs++;
      row.retries += Number(event.status === 'retry');
      row.lastStatus = event.status;
      if (event.error !== undefined) row.lastError = event.error;
      row.lastAt = event.at;
    } else {
      rowsByJob.set(event.job, {
        job: event.job,
        owner: event.owner,
        runs: 1,
        retries: Number(event.status === 'retry'),
        lastStatus: event.status,
        lastError: event.error ?? null,
        firstAt: event.at,
        lastAt: event.at,
      });
    }
  }
  return {
    kind: 'found', night,
    rows: [...rowsByJob.values()].sort((a, b) => stringOrder(a.job, b.job)),
    malformedLineCount, statusCounts,
  };
};
