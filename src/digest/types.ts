/** Status of one valid log event, not an aggregate job outcome. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/** Validated JSONL input. Keep at exactly as logged, including its offset. */
export type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

/**
 * One job's valid events, ordered by timestamp instant (file order breaks ties).
 * Invalid events never contribute to a row. Timestamp strings retain the source
 * spelling and offset; comparing instants must not normalize displayed values.
 */
export type DigestRow = {
  job: string;
  /** Owner on the latest event, including null. */
  owner: string | null;
  /** All valid events for this job, including ok, retry and fail. */
  runs: number;
  /** Valid events whose status is retry. */
  retries: number;
  lastStatus: RunStatus;
  /** Most recent supplied error; a later event without error does not clear it. */
  lastError: string | null;
  /** Original timestamp of the earliest valid event. */
  firstAt: string;
  /** Original timestamp of the latest valid event. */
  lastAt: string;
};

/**
 * Raw valid event totals for the board, not counts of rows by lastStatus.
 * Their sum equals the sum of rows' runs; retry equals the sum of retries.
 */
export type EventStatusCounts = Record<RunStatus, number>;

/** No file exists for this night. Consumers map this result to HTTP 404. */
export type MissingNight = {
  kind: 'missing';
  night: string;
};

/** A file exists, even when it contains no valid events. */
export type FoundNight = {
  kind: 'found';
  night: string;
  /** One row per job, ascending by job using case-sensitive string order. */
  rows: DigestRow[];
  /**
   * Nonblank lines that fail JSON parsing or RunEvent validation.
   * Blank lines (including a trailing newline) are ignored.
   */
  malformedLineCount: number;
  /** All three keys are present, including zero counts. */
  statusCounts: EventStatusCounts;
};

/**
 * An empty/blank file is found with [], zero malformed lines and zero counts.
 * A malformed-only file is found with [] and a positive malformedLineCount.
 * Missing nights have no fabricated rows or counts.
 */
export type ReadNightResult = MissingNight | FoundNight;

/**
 * Synchronously read runsDir/<night>.jsonl; night is a YYYY-MM-DD identifier.
 * A missing file returns MissingNight; other I/O errors propagate to the caller.
 * Malformed lines are counted and skipped, so remaining valid events still render.
 *
 * Type-only contract: this module exports no runtime readNight function.
 * Consumers: import type { DigestRow, ReadNight } from './digest/types.js';
 * The later reader exports readNight from './digest/reader.js', typed ReadNight.
 * Until then, accept a ReadNight dependency rather than importing a runtime stub.
 * Paths above are relative to src/; adjust them for each consumer's location.
 */
export type ReadNight = (runsDir: string, night: string) => ReadNightResult;
