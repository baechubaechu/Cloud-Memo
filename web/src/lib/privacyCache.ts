/** Remove plaintext API caches left by versions predating encrypted device storage. */
export async function clearLegacyNoteCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  await Promise.all(["apis", "cross-origin"].map((name) => caches.delete(name)));
}
