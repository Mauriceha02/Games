import { readFile } from 'node:fs/promises';

export async function connectionService(root) {
  const module = await readFile(new URL('public/app/network/service.js', root), 'utf8');
  const match = /^export const SERVICE_URL = (null|"[^"]+");\n$/.exec(module);
  if (!match) throw new Error('Ungültige Konfiguration des Verbindungsdienstes.');
  const url = JSON.parse(match[1]);
  if (url !== null && !/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev$/.test(url)) throw new Error('Ungültige Adresse des Verbindungsdienstes.');
  return url;
}
