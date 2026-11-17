import { bindings, defineConfig, triggers } from 'cf/config';
import * as entrypoint from './src/worker.ts' with { type: 'cf-worker' };

export default defineConfig({
  worker: {
    name: 'portal',
    compatibilityDate: '2026-11-16',
    entrypoint,
    domains: ['portal.gleamfilms.com'],
    assets: {
      notFoundHandling: 'single-page-application',
      runWorkerFirst: ['/api/*', '/media/*', '/audio/*'],
    },
    env: {
      DB: bindings.d1({ name: 'portal-db' }),
      MEDIA: bindings.r2({ name: 'portal-media' }),
      // One-time code + email that unlock creating the owner account.
      SETUP_CODE: bindings.secret(),
      OWNER_EMAIL: bindings.secret(),
    },
    // Hourly: clear removed videos and old versions of projects that have sat in Done for a week.
    triggers: [triggers.scheduled({ schedule: '17 * * * *' })],
    observability: { enabled: true },
  },
});
