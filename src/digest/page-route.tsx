import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { lane } from '../lane.js';
import type { ReadNight } from './types.js';
import { DigestPage } from '../views/digest.js';
import { Layout } from '../views/layout.js';

export function registerDigestPage(app: Hono, config: RigConfig, readNight: ReadNight): void {
  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const result = readNight(config.runsDir, night);

    if (result.kind === 'missing') {
      return c.html(
        <Layout title={`digest · ${night}`} lane={lane()}>
          <h1>404 · digest · {night}</h1>
          <p class="warn">night not found</p>
        </Layout>,
        404,
      );
    }

    return c.html(
      <Layout title={`digest · ${night}`} lane={lane()}>
        <DigestPage result={result} />
      </Layout>,
    );
  });
}
