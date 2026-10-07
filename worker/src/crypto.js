/** Cifratura AES-GCM del refresh token, con la chiave TOKEN_KEY (secret del worker). */

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(env) {
  return crypto.subtle.importKey("raw", unb64(env.TOKEN_KEY), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), new TextEncoder().encode(text));
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function open(env, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}
