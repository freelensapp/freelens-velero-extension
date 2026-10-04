// The addresses a download may be sent to, by what they are and not by how they are written. An address
// has many written forms, and a rule that compares texts lets through the form it does not know: an
// address is read into its numbers here, and the rules are on the numbers. Pure functions on plain text,
// with no module of the runtime: this folder is of both processes.

type AddressClass = "refused" | "loopback" | "private" | "public";

// The four bytes of an IPv4 address: decimal numbers, all four written. A number with a leading zero is
// not one of them: some resolvers read it as octal, and 010.0.0.1 would be 8.0.0.1 to them.
function ipv4(text: string): number[] | undefined {
  const parts = text.split(".");

  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255))
    return undefined;
  return parts.map(Number);
}

// The groups one side of `::` writes, or all eight without it: one to four hexadecimal digits each. The
// last two may be written as an IPv4 address, at the end of the text only.
function side(text: string, end: boolean): number[] | undefined {
  const groups: number[] = [];

  if (text === "") return groups;
  const parts = text.split(":");

  for (const [index, part] of parts.entries()) {
    if (end && index === parts.length - 1 && part.includes(".")) {
      const bytes = ipv4(part);

      if (!bytes) return undefined;
      groups.push(bytes[0] * 256 + bytes[1], bytes[2] * 256 + bytes[3]);
    } else if (/^[0-9a-f]{1,4}$/i.test(part)) groups.push(Number.parseInt(part, 16));
    else return undefined;
  }
  return groups;
}

// The eight groups of an IPv6 address, with `::` once at most for the groups of zeros that are not
// written, which are one at least. A zone identifier, a prefix length and the brackets of a URL are not
// part of an address.
function ipv6(text: string): number[] | undefined {
  const sides = text.split("::");

  if (sides.length > 2) return undefined;
  const head = side(sides[0], sides.length === 1);
  const tail = sides.length === 2 ? side(sides[1], true) : [];

  if (!head || !tail) return undefined;
  if (sides.length === 1) return head.length === 8 ? head : undefined;
  if (head.length + tail.length > 7) return undefined;
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

function parse(text: string): { bytes: number[] } | { groups: number[] } | undefined {
  // The longest written form of an address has 45 characters.
  if (typeof text !== "string" || text.length > 45) return undefined;
  const bytes = ipv4(text);

  if (bytes) return { bytes };
  const groups = ipv6(text);

  return groups ? { groups } : undefined;
}

// The IPv4 address an IPv6 one carries in its last two groups, under the two prefixes that say so by
// themselves: ::ffff:0:0/96, the IPv4 address itself on a socket of IPv6, and 64:ff9b::/96, the IPv4
// address as a translator of IPv6 to IPv4 gives it. The prefix a network chooses for a translator of its
// own cannot be known from the address.
function carried(groups: number[]): { by: "mapped" | "translated"; bytes: number[] } | undefined {
  const bytes = [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255];
  const zeros = (from: number, to: number) => groups.slice(from, to).every((group) => group === 0);

  if (zeros(0, 5) && groups[5] === 0xffff) return { by: "mapped", bytes };
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6)) return { by: "translated", bytes };
  return undefined;
}

// The canonical form of an IPv4 or IPv6 address, which is the same for every way the address is written,
// and undefined for what is not an address. Of IPv6 it is the form of RFC 5952: lower case, no zero a
// group does not need, the longest run of two or more groups of zeros left out, the first one of two of
// the same length; and an address that carries an IPv4 one is written with it, as ::ffff:192.0.2.1.
export function canonicalAddress(text: string): string | undefined {
  const address = parse(text);

  if (!address) return undefined;
  if ("bytes" in address) return address.bytes.join(".");
  const { groups } = address;
  const inside = carried(groups);

  if (inside) return `${inside.by === "mapped" ? "::ffff:" : "64:ff9b::"}${inside.bytes.join(".")}`;
  let start = 0;
  let length = 0;

  for (let at = 0; at < 8; at += 1) {
    let end = at;

    while (end < 8 && groups[end] === 0) end += 1;
    if (end - at > length) {
      start = at;
      length = end - at;
    }
    at = Math.max(at, end);
  }
  const written = (part: number[]) => part.map((group) => group.toString(16)).join(":");

  if (length < 2) return written(groups);
  return `${written(groups.slice(0, start))}::${written(groups.slice(start + length))}`;
}

// The addresses the clouds serve their metadata at that are in no range that is refused: each is one
// address, inside a range a store may be in, and is never connected to.
const METADATA_IPV4 = ["168.63.129.16", "100.100.100.200", "192.0.0.192"];
const METADATA_IPV6 = [
  [0xfd20, 0xce, 0, 0, 0, 0, 0, 0x254],
  [0xfd00, 0xa9fe, 0xa9fe, 0, 0, 0, 0, 1],
];

function classifyIpv4(bytes: number[]): AddressClass {
  const [first, second] = bytes;

  // 0.0.0.0/8 with the unspecified address, the link-local 169.254.0.0/16 where the metadata services of
  // most clouds are, the multicast 224.0.0.0/4 with 240.0.0.0/4 after it, and the metadata addresses that
  // are in none of them.
  if (first === 0 || first >= 224 || (first === 169 && second === 254) || METADATA_IPV4.includes(bytes.join(".")))
    return "refused";
  if (first === 127) return "loopback";
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 and 198.18.0.0/15.
  if (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19))
  )
    return "private";
  return "public";
}

// What an address is, for the rules of a download: one that is never connected to, the loopback of this
// machine, one of a private network, which needs an allowance, or any other. What is not an address is
// refused.
//
// An address that carries an IPv4 one is what the IPv4 one is. A mapped address is the IPv4 address
// itself, on a socket of IPv6: a public one is public, a private one private, the loopback the loopback.
// A translated address reaches the IPv4 one through a translator: a public one is public and a private
// one private, and the loopback is refused, as it would be the one of the translator and not of this
// machine.
export function classifyAddress(text: string): AddressClass {
  const address = parse(text);

  if (!address) return "refused";
  if ("bytes" in address) return classifyIpv4(address.bytes);
  const [first, second] = address.groups;
  const inside = carried(address.groups);

  if (inside) {
    const kind = classifyIpv4(inside.bytes);

    return inside.by === "translated" && kind === "loopback" ? "refused" : kind;
  }
  // The unspecified address and the loopback: :: and ::1.
  if (address.groups.slice(0, 7).every((group) => group === 0) && address.groups[7] < 2)
    return address.groups[7] === 1 ? "loopback" : "refused";
  // The rest of ::/96, where the standard once wrote an IPv4 address after ninety-six zeros and took it
  // back: no rule of IPv4 would be asked of what such an address carries, and no store is at one.
  if (address.groups.slice(0, 6).every((group) => group === 0)) return "refused";
  // The prefix a network uses for a translator of its own, 64:ff9b:1::/48: the IPv4 address its last two
  // groups carry is what is reached, as far as the address says it, and the loopback of the translator is
  // not the one of this machine.
  if (first === 0x64 && second === 0xff9b && address.groups[2] === 1) {
    const [high, low] = address.groups.slice(6);
    const kind = classifyIpv4([high >> 8, high & 255, low >> 8, low & 255]);

    return kind === "loopback" ? "refused" : kind;
  }
  // The link-local fe80::/10, the multicast ff00::/8, the network of a metadata service, fd00:ec2::/32,
  // which is inside the private fc00::/7, and the metadata addresses that are one address of such a range.
  if (
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0xfd00 && second === 0x0ec2) ||
    METADATA_IPV6.some((groups) => groups.every((group, index) => group === address.groups[index]))
  )
    return "refused";
  if ((first & 0xfe00) === 0xfc00) return "private";
  return "public";
}

// The name of a metadata service, which is refused before it is resolved: in any case, with or without
// the dot that ends a name.
export function isMetadataName(host: string): boolean {
  return typeof host === "string" && host.toLowerCase().replace(/\.$/, "") === "metadata.google.internal";
}
