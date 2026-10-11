import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { connectionService } from '../scripts/connection-service.mjs';

test('the service configuration cannot inject CSP directives or use another service origin', async () => {
  const directory = await mkdtemp(tmpdir() + '/games-service-');
  const root = pathToFileURL(directory + '/');
  const module = new URL('public/app/network/service.js', root);
  await mkdir(new URL('./', module), { recursive: true });
  try {
    for (const value of [null, 'https://games-connect.example.workers.dev']) {
      await writeFile(module, `export const SERVICE_URL = ${JSON.stringify(value)};\n`);
      assert.equal(await connectionService(root), value);
    }
    for (const value of ['http://example.workers.dev', 'https://attacker.test', 'https://example.workers.dev/path', 'https://example.workers.dev;script-src unsafe-inline', 'https://example.workers.dev";alert(1)']) {
      await writeFile(module, `export const SERVICE_URL = ${JSON.stringify(value)};\n`);
      await assert.rejects(connectionService(root));
    }
    await writeFile(module, 'export const SERVICE_URL = null;\nalert(1);\n');
    await assert.rejects(connectionService(root));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
