// The value of a label that carries a name, by the rule of the reviewed release: a name longer than the 63
// characters a label value may have is cut to its first 57, followed by the first 6 hexadecimal characters
// of the SHA-256 of the whole name (docs/development/RECON-T0.1.md, the labels). The release counts bytes,
// which for a name are its characters. The main process writes the labels of the requests it creates with
// it, and the renderer finds what a label names with it: the digest is computed here, with no module of
// Node, so that both read the same function. Decided while implementing, on 2026-10-26: the host gives a
// SHA-256 in `Common.Util.sha256Hex`, but the references that use the cut are pure functions of this
// folder, which read nothing of the host and are tested without it, and the Web Crypto of both runtimes
// answers later, which a derivation of a view cannot wait for.

const MAXIMUM = 63;
const KEPT = 57;
const DIGITS = 6;

const ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

function rotate(value: number, by: number): number {
  return (value >>> by) | (value << (32 - by));
}

// The bytes of a text in UTF-8.
function utf8(text: string): number[] {
  const bytes: number[] = [];

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;

    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}

// The SHA-256 of a text, in hexadecimal (FIPS 180-4).
function sha256Hex(text: string): string {
  const bytes = utf8(text);
  const bits = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (const word of [Math.floor(bits / 0x100000000), bits >>> 0]) {
    bytes.push((word >>> 24) & 255, (word >>> 16) & 255, (word >>> 8) & 255, word & 255);
  }
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words: number[] = new Array(64).fill(0);

  for (let block = 0; block < bytes.length; block += 64) {
    for (let at = 0; at < 16; at++) {
      const first = block + at * 4;

      words[at] = (bytes[first] << 24) | (bytes[first + 1] << 16) | (bytes[first + 2] << 8) | bytes[first + 3];
    }
    for (let at = 16; at < 64; at++) {
      const low = rotate(words[at - 15], 7) ^ rotate(words[at - 15], 18) ^ (words[at - 15] >>> 3);
      const high = rotate(words[at - 2], 17) ^ rotate(words[at - 2], 19) ^ (words[at - 2] >>> 10);

      words[at] = (words[at - 16] + low + words[at - 7] + high) | 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;

    for (let at = 0; at < 64; at++) {
      const one =
        (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + ROUND[at] + words[at]) | 0;
      const two = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + one) | 0;
      d = c;
      c = b;
      b = a;
      a = (one + two) | 0;
    }
    for (const [at, value] of [a, b, c, d, e, f, g, h].entries()) hash[at] = (hash[at] + value) | 0;
  }
  return hash.map((value) => (value >>> 0).toString(16).padStart(8, "0")).join("");
}

export function labelOf(name: string): string {
  if (name.length <= MAXIMUM) return name;
  return `${name.slice(0, KEPT)}${sha256Hex(name).slice(0, DIGITS)}`;
}
