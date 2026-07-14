/**
 * Isomorphic SHA-256 via the WebCrypto `SubtleCrypto` API, present as a global
 * both in browsers and in Node (>=20, backed by node:crypto's webcrypto
 * implementation). Using the global keeps this package dependency-free and
 * bundler-safe for the client without a separate Node-only code path.
 */
export async function sha256Hex(message: string): Promise<string> {
  const bytes = new TextEncoder().encode(message);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

export function randomSeedHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}
