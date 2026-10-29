import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const configFor = (runsDir: string) => ({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

const event = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });

describe('digest routes', () => {
  let runsDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-test-'));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it('renders a found night as HTML and JSON with matching sorted jobs', async () => {
    await writeFile(
      join(runsDir, '2026-10-28.jsonl'),
      [
        event('2026-10-28T23:10:00+01:00', 'zeta', 'ok', 'Zed'),
        event('2026-10-28T23:00:00+01:00', 'alpha', 'ok', 'Ada'),
        event('2026-10-28T23:01:00+01:00', 'alpha', 'retry', 'Ada'),
        event('2026-10-28T23:02:00+01:00', 'alpha', 'retry', 'Ada'),
        event('2026-10-28T23:03:00+01:00', 'alpha', 'retry', 'Ada'),
        event('2026-10-28T23:04:00+01:00', 'alpha', 'fail', 'Ada', 'could not finish'),
      ].join('\n') + '\n',
    );
    const app = createApp(configFor(runsDir));

    const htmlResponse = await app.request('/digest/2026-10-28');
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('alpha');
    expect(html).toContain('zeta');
    expect(html.indexOf('alpha')).toBeLessThan(html.indexOf('zeta'));
    expect(html).toContain('could not finish');
    expect(html).toMatch(/class="warn">3<\/span>/);
    expect(html).toMatch(/class="warn">fail<\/span>/);

    const jsonResponse = await app.request('/api/digest/2026-10-28');
    expect(jsonResponse.status).toBe(200);
    const result: unknown = await jsonResponse.json();
    expect(result).toMatchObject({
      kind: 'found',
      night: '2026-10-28',
      rows: [
        { job: 'alpha', retries: 3, lastStatus: 'fail', lastError: 'could not finish' },
        { job: 'zeta' },
      ],
    });
    const jobsInJson = (result as { rows: { job: string }[] }).rows.map((row) => row.job);
    const tableBody = /<tbody>(.*?)<\/tbody>/s.exec(html)?.[1] ?? '';
    const jobsInHtml = [...tableBody.matchAll(/<tr><td>(.*?)<\/td>/g)].map((match) => match[1]);
    expect(jobsInHtml).toEqual(jobsInJson);
  });

  it('returns a missing result and 404 for HTML and JSON when the night is absent', async () => {
    const app = createApp(configFor(runsDir));

    const htmlResponse = await app.request('/digest/2026-10-29');
    expect(htmlResponse.status).toBe(404);

    const jsonResponse = await app.request('/api/digest/2026-10-29');
    expect(jsonResponse.status).toBe(404);
    await expect(jsonResponse.json()).resolves.toEqual({ kind: 'missing', night: '2026-10-29' });
  });

  it('renders an existing empty night as nothing ran and an empty JSON envelope', async () => {
    await writeFile(join(runsDir, '2026-10-27.jsonl'), '');
    const app = createApp(configFor(runsDir));

    const htmlResponse = await app.request('/digest/2026-10-27');
    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toMatch(/nothing ran/i);

    const jsonResponse = await app.request('/api/digest/2026-10-27');
    expect(jsonResponse.status).toBe(200);
    await expect(jsonResponse.json()).resolves.toMatchObject({
      kind: 'found',
      night: '2026-10-27',
      rows: [],
      malformedLineCount: 0,
      statusCounts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed lines and keeps valid null-owner rows and original timestamp offsets', async () => {
    await writeFile(
      join(runsDir, '2026-10-26.jsonl'),
      [
        '{not json',
        event('2026-10-26T22:15:00+01:00', 'report', 'ok', null),
        '',
      ].join('\n'),
    );
    const app = createApp(configFor(runsDir));

    const htmlResponse = await app.request('/digest/2026-10-26');
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('report');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-26T22:15:00+01:00');
    expect(html).toMatch(/malformed|invalid/i);

    const jsonResponse = await app.request('/api/digest/2026-10-26');
    expect(jsonResponse.status).toBe(200);
    await expect(jsonResponse.json()).resolves.toMatchObject({
      kind: 'found',
      malformedLineCount: 1,
      rows: [{ job: 'report', owner: null, firstAt: '2026-10-26T22:15:00+01:00', lastAt: '2026-10-26T22:15:00+01:00' }],
      statusCounts: { ok: 1, retry: 0, fail: 0 },
    });
  });

  it('escapes untrusted log text in HTML', async () => {
    await writeFile(
      join(runsDir, '2026-10-25.jsonl'),
      `${event('2026-10-25T22:15:00+01:00', '<img src=x onerror=alert(1)>', 'fail', '<script>alert(1)</script>')}\n`,
    );
    const response = await createApp(configFor(runsDir)).request('/digest/2026-10-25');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
