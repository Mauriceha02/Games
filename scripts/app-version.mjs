// The first run of publish.yml releases 1.0.0.5; local previews use the same starting version.
export const BASE_APP_VERSION = '1.0.0.5';

export function appVersion(releaseNumber = process.env.PHASE10_RELEASE_NUMBER) {
  if (releaseNumber === undefined) return BASE_APP_VERSION;
  if (!/^[1-9]\d*$/.test(releaseNumber) || !Number.isSafeInteger(Number(releaseNumber))) {
    throw new Error('Die Veröffentlichungsnummer muss eine positive ganze Zahl sein.');
  }
  const parts = BASE_APP_VERSION.split('.');
  const revision = Number(parts.pop()) + Number(releaseNumber) - 1;
  if (!Number.isSafeInteger(revision)) throw new Error('Die Veröffentlichungsnummer ist zu groß.');
  return [...parts, revision].join('.');
}
