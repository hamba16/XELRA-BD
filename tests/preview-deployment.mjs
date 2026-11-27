import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

// Optional access file is temporary and ignored; never log its share-link value.
const target = new URL(process.env.PREVIEW_TEST_URL || 'http://127.0.0.1:4173');
const access = process.env.PREVIEW_ACCESS_FILE
  ? JSON.parse(readFileSync(process.env.PREVIEW_ACCESS_FILE, 'utf8'))
  : null;
const profiles = JSON.parse(readFileSync(new URL('../infrastructure/preview-profiles.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const externalRequests = [];
const errors = [];
try {
  if (access) {
    const url = new URL(access.url);
    assert.equal(url.origin, target.origin, 'share URL must belong to the tested deployment');
    await page.goto(url.href);
    await page.goto(target.origin);
  }
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== target.origin && ['http:', 'https:'].includes(url.protocol)) {
      externalRequests.push(url.origin);
      await route.abort();
    } else await route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  for (const profile of profiles) {
    await page.goto(target.origin);
    await page.getByRole('button', { name: 'Authorised access only.' }).click({ clickCount: 3 });
    await page.getByLabel('Development profile').selectOption(profile.id);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.locator('.rail-bottom strong').filter({ hasText: profile.name }).waitFor();
    const projectsVisible = await page.getByRole('button', { name: 'Projects', exact: true }).count();
    assert.equal(projectsVisible > 0, profile.permissions.includes('projects.read'), profile.id);
    const adminVisible = await page.getByRole('button', { name: 'Administration', exact: true }).count();
    assert.equal(adminVisible > 0, profile.permissions.includes('ops.read'), profile.id);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  }
  assert.deepEqual(externalRequests, [], 'synthetic walkthrough must never contact another origin');
  assert.deepEqual(errors, [], 'browser must not report uncaught errors');
  if (target.protocol === 'https:') {
    for (const path of ['/', '/settings', '/projects', '/auth/callback/']) {
      const response = await context.request.get(new URL(path, target).href);
      assert.equal(response.status(), 200, path);
      assert.match(response.headers()['x-robots-tag'] || '', /noindex/);
      assert.match(response.headers()['content-security-policy'] || '', /frame-ancestors 'none'/);
      assert.match(await response.text(), /id="root"/);
    }
    const missing = await context.request.get(new URL('/not-a-xelra-route', target).href);
    assert.equal(missing.status(), 404);
    assert.match(await missing.text(), /This page could not be found/);
    const asset = await page.locator('script[src]').first().getAttribute('src');
    assert.ok(asset?.startsWith('/assets/'));
    const assetResponse = await context.request.get(new URL(asset, target).href);
    assert.equal(assetResponse.status(), 200);
    assert.match(assetResponse.headers()['cache-control'] || '', /immutable/);
  }
  console.log(JSON.stringify({ origin: target.origin, profiles: profiles.length, externalRequests: 0, uncaughtErrors: 0, hostedRoutesChecked: target.protocol === 'https:' }));
} finally {
  await browser.close();
}
