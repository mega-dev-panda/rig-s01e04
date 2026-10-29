import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';
import type { FoundNight, RunEvent } from '../src/digest/types.js';

const night = '2026-10-28';
const fixtures = fileURLToPath(new URL('../runs/', import.meta.url));
const event: RunEvent = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };

function found(dir: string, selectedNight = night): FoundNight {
  const result = readNight(dir, selectedNight);
  expect(result.kind).toBe('found');
  if (result.kind !== 'found') throw new Error('Expected a found night');
  return result;
}

describe('readNight', () => {
  let temp: string;
  let runsDir: string;
  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'rig-reader-'));
    runsDir = join(temp, 'runs');
    mkdirSync(runsDir);
  });
  afterEach(() => rmSync(temp, { recursive: true, force: true }));

  function write(events: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map(value => JSON.stringify(value)).join('\n'));
  }

  it('aggregates the real fixture into five sorted jobs with one bad line', () => {
    const result = found(fixtures);
    expect(result.malformedLineCount).toBe(1);
    expect(result.statusCounts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(result.rows).toEqual([
      { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
      { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
        firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
      { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
        firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
      { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
      { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
    ]);
    expect(result.rows.reduce((total, row) => total + row.runs, 0)).toBe(15);
  });

  it('reads the other real night and counts events, not final job statuses', () => {
    const result = found(fixtures, '2026-10-27');
    expect(result.rows).toHaveLength(4);
    expect(result.statusCounts).toEqual({ ok: 7, retry: 0, fail: 0 });
    expect(result.malformedLineCount).toBe(0);
  });

  it('returns only a missing result for ENOENT', () => {
    expect(readNight(runsDir, night)).toEqual({ kind: 'missing', night });
    expect(readNight(join(temp, 'absent'), night)).toEqual({ kind: 'missing', night });
  });

  it.each(['', '\n \t\r\n\n'])('distinguishes an empty or blank file from a missing file (%j)', contents => {
    writeFileSync(join(runsDir, `${night}.jsonl`), contents);
    expect(readNight(runsDir, night)).toEqual({ kind: 'found', night, rows: [], malformedLineCount: 0,
      statusCounts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts malformed-only files while ignoring blank lines', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), '\nnot JSON\r\n \t\r\nnull\n{\n');
    expect(readNight(runsDir, night)).toEqual({ kind: 'found', night, rows: [], malformedLineCount: 3,
      statusCounts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('skips invalid shapes without dropping valid null owners', () => {
    const invalid: unknown[] = [null, [], true, 42, 'event', {},
      { ...event, at: undefined }, { ...event, at: 123 }, { ...event, job: null },
      { ...event, status: 'pending' }, { ...event, owner: undefined }, { ...event, owner: 0 },
      { ...event, error: null }, { ...event, error: false }];
    write([...invalid, { ...event, owner: null }]);
    const result = found(runsDir);
    expect(result.malformedLineCount).toBe(invalid.length);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ owner: null, runs: 1, lastError: null });
    expect(result.statusCounts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it.each(['2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-13-01T00:00:00Z',
    '2026-10-28T24:00:00Z', '2026-10-28T23:60:00Z', '2026-10-28T23:00:60Z',
    '2026-10-28T23:00:00+24:00', '2026-10-28T23:00:00+01:60',
    '2026-10-28T23:00:00', '2026-10-28', 'not a date'])('rejects invalid or timezone-free timestamps: %s', at => {
    write([{ ...event, at }, event]);
    expect(found(runsDir)).toMatchObject({ malformedLineCount: 1, statusCounts: { ok: 1, retry: 0, fail: 0 } });
  });

  it('sorts by instant with file-order ties and keeps source offsets, latest owner and latest supplied error', () => {
    write([
      { ...event, at: '2024-02-29T01:00:00-01:00', owner: 'last', status: 'fail' },
      { ...event, at: '2024-02-29T03:00:00+02:00', error: 'new error', status: 'retry' },
      { ...event, at: '2024-02-29T00:00:00Z', error: 'old error', status: 'fail' },
      { ...event, at: '2024-02-29T02:00:00Z', owner: null },
    ]);
    expect(found(runsDir).rows).toEqual([{ job: 'job', owner: null, runs: 4, retries: 1,
      lastStatus: 'ok', lastError: 'new error', firstAt: '2024-02-29T00:00:00Z', lastAt: '2024-02-29T02:00:00Z' }]);
  });

  it('orders fractional seconds precisely and retains empty supplied errors', () => {
    write([
      { ...event, at: '2026-10-28T23:00:00.0002Z', error: '' },
      { ...event, at: '2026-10-28T23:00:00.0001Z', error: 'earlier' },
      { ...event, at: '2026-10-28T23:00:00.00020Z', owner: null },
    ]);
    expect(found(runsDir).rows[0]).toMatchObject({ firstAt: '2026-10-28T23:00:00.0001Z',
      lastAt: '2026-10-28T23:00:00.00020Z', owner: null, lastError: '' });
  });

  it('sorts jobs in case-sensitive string order, including object prototype names', () => {
    write(['a', 'Z', '__proto__', 'A', 'constructor'].map(job => ({ ...event, job })));
    expect(found(runsDir).rows.map(row => row.job)).toEqual(['A', 'Z', '__proto__', 'a', 'constructor']);
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28/../../secret', '2026-10-28\\..',
    '2026-10-28\0', '2026-10-28\n', '2026-02-29'])('rejects invalid night identifiers before I/O: %j', invalidNight => {
    expect(() => readNight(join(temp, 'absent'), invalidNight)).toThrow(RangeError);
  });

  it('rejects a night symlink that points outside runsDir', () => {
    const outside = join(temp, 'outside.jsonl');
    writeFileSync(outside, JSON.stringify(event));
    symlinkSync(outside, join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow('Night file must remain inside runsDir');
  });

  it('propagates non-ENOENT I/O errors', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow(expect.objectContaining({ code: 'EISDIR' }));
  });
});
