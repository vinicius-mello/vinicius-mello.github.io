// Share a program through the URL fragment: #n=<name>&c=<deflate-raw, base64url>.
// The fragment never reaches the server, so links work on any static host.

const toB64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeProgram(text) {
  return toB64url(await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw')));
}

export async function decodeProgram(code) {
  return new TextDecoder().decode(await pipe(fromB64url(code), new DecompressionStream('deflate-raw')));
}

export async function shareURL(text, name, base = location.href) {
  const url = new URL(base);
  const params = new URLSearchParams();
  if (name) params.set('n', name);
  params.set('c', await encodeProgram(text));
  url.hash = params.toString();
  return url.href;
}

// The shared program in a fragment, or null when there is none.
export async function readShared(hash = location.hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('c');
  if (!code) return null;
  return { name: params.get('n') || null, text: await decodeProgram(code) };
}
