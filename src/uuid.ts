/**
 * Tiny UUID v7 generator (time-ordered) — RFC draft `draft-peabody-dispatch-new-uuid-format`.
 *
 * Used for client-generated `Idempotency-Key`s. v7 is preferable to v4 because
 * its prefix is a millisecond timestamp, which makes idempotency keys naturally
 * sortable in logs / DB indexes.
 *
 * Cross-runtime: uses `globalThis.crypto.getRandomValues` — present in Node 20+,
 * Bun, Deno, browsers, and Edge runtimes. No node-only imports.
 */

function getRandomBytes(buf: Uint8Array): Uint8Array {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error(
      'Scoope SDK: globalThis.crypto.getRandomValues is unavailable. Upgrade to Node 20+ or run in a modern runtime.',
    );
  }
  c.getRandomValues(buf);
  return buf;
}

/**
 * Generate a UUID v7 string. Format: `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx`
 * where the leading 48 bits are the current Unix time in ms.
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  getRandomBytes(bytes);

  const ms = Date.now();
  // 48 bits of unix-millis
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;

  // version 7 in top nibble of byte 6
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // RFC 4122 variant in top two bits of byte 8
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i]!.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
