import test from 'node:test';
import assert from 'node:assert/strict';
import { appVersion, BASE_APP_VERSION } from '../scripts/app-version.mjs';

test('publication starts at 1.0.0.5 and increments independently of local builds', () => {
  assert.equal(BASE_APP_VERSION, '1.0.0.5');
  assert.equal(appVersion('1'), '1.0.0.5');
  assert.equal(appVersion('2'), '1.0.0.6');
  assert.equal(appVersion('6'), '1.0.0.10');
  assert.equal(appVersion('2'), '1.0.0.6', 're-running a release keeps its version');
});

test('invalid release numbers fail instead of generating misleading versions or markup', () => {
  for (const number of ['', '0', '-1', '1.5', '01', 'NaN', '<script>', '9007199254740991', '9007199254740992']) {
    assert.throws(() => appVersion(number));
  }
});
