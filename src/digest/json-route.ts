import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import type { ReadNight } from './types.js';

export function registerDigestJson(
  app: Hono,
  config: RigConfig,
  readNight: ReadNight,
): void {
  app.get('/api/digest/:night', (c) => {
    const result = readNight(config.runsDir, c.req.param('night'));
    return c.json(result, result.kind === 'missing' ? 404 : 200);
  });
}
