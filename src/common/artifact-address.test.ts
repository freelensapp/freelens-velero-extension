import { describe, expect, it } from "vitest";
import { canonicalAddress, classifyAddress, isMetadataName } from "./artifact-address";

describe("an address in its canonical form", () => {
  it.each([
    ["127.0.0.1", "127.0.0.1"],
    ["0.0.0.0", "0.0.0.0"],
    ["255.255.255.255", "255.255.255.255"],
    // The loopback of IPv6, in the forms it is written in.
    ["::1", "::1"],
    ["0:0:0:0:0:0:0:1", "::1"],
    ["::0001", "::1"],
    ["0000:0000:0000:0000:0000:0000:0000:0001", "::1"],
    ["0::1", "::1"],
    ["::0.0.0.1", "::1"],
    ["::", "::"],
    ["0:0:0:0:0:0:0:0", "::"],
    ["::0", "::"],
    ["0::", "::"],
    ["::0.0.0.0", "::"],
    // Lower case, and no zero a group does not need.
    ["2001:DB8::1", "2001:db8::1"],
    ["2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
    ["FE80::ABCD", "fe80::abcd"],
    // The longest run of groups of zeros is the one left out, the first of two of the same length, and a
    // single group of zeros is written.
    ["2001:0:0:1:0:0:0:1", "2001:0:0:1::1"],
    ["2001:db8:0:0:1:0:0:1", "2001:db8::1:0:0:1"],
    ["2001:db8:0:1:1:1:1:1", "2001:db8:0:1:1:1:1:1"],
    ["1:2:3:4:5:6:7::", "1:2:3:4:5:6:7:0"],
    ["::2:3:4:5:6:7:8", "0:2:3:4:5:6:7:8"],
    ["1::", "1::"],
    ["1:0:0:0:0:0:0:0", "1::"],
    // The last two groups written as an IPv4 address are two groups like the others.
    ["1:2:3:4:5:6:7.8.9.10", "1:2:3:4:5:6:708:90a"],
    ["::1.2.3.4", "::102:304"],
    // Under the two prefixes that carry an IPv4 address, the address is written as one.
    ["::ffff:a9fe:a9fe", "::ffff:169.254.169.254"],
    ["::FFFF:169.254.169.254", "::ffff:169.254.169.254"],
    ["0:0:0:0:0:ffff:0a00:0001", "::ffff:10.0.0.1"],
    ["64:ff9b::a9fe:a9fe", "64:ff9b::169.254.169.254"],
    ["0064:FF9B:0:0:0:0:8.8.8.8", "64:ff9b::8.8.8.8"],
    // An address that only begins as the first of the two does.
    ["0:0:0:0:ffff:0:0:1", "::ffff:0:0:1"],
  ])("writes %s as %s", (written, canonical) => {
    expect(canonicalAddress(written)).toBe(canonical);
    // The canonical form is one of the forms: it is read back as itself.
    expect(canonicalAddress(canonical)).toBe(canonical);
  });

  it.each([
    "",
    " ",
    "localhost",
    "storage.example.invalid",
    // An IPv4 address is four decimal numbers of one byte, and nothing shorter.
    "1.2.3",
    "1.2.3.4.5",
    "1.2.3.",
    ".1.2.3",
    "256.0.0.1",
    "1.2.3.-4",
    "1.2.3.+4",
    "1.2.3.4e0",
    "127.1",
    "2130706433",
    "0x7f.0.0.1",
    // A leading zero, which some resolvers read as octal: 010.0.0.1 would be 8.0.0.1 to them.
    "010.0.0.1",
    "127.0.0.01",
    "00.0.0.0",
    // Digits that are not the ten of ASCII.
    "１２７.0.0.1",
    // Nothing around an address is part of it.
    " 127.0.0.1",
    "127.0.0.1 ",
    "127.0.0.1\n",
    "::1\n",
    "[::1]",
    // A prefix length, and a zone identifier.
    "10.0.0.0/8",
    "::1/128",
    "fe80::1%eth0",
    "fe80::1%25eth0",
    "::1%lo0",
    // An IPv6 address is eight groups, of four hexadecimal digits at most, with `::` once.
    ":",
    ":::",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7:8::",
    "::1:2:3:4:5:6:7:8",
    "1::2::3",
    ":1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:",
    "12345::",
    "g::1",
    "0x1::",
    "-1::",
    // An IPv4 address is written at the end only, whole, and as one is written.
    "::ffff:1.2.3",
    "::ffff:01.2.3.4",
    "::ffff:256.0.0.1",
    "::1.2.3.4.5",
    "1.2.3.4::",
    "::1.2.3.4:5",
    "1:2:3:4:5:6:7:1.2.3.4",
    "f".repeat(64),
  ])("reads no address from %j", (written) => {
    expect(canonicalAddress(written)).toBeUndefined();
    expect(classifyAddress(written)).toBe("refused");
  });

  it("reads no address from what is not a text", () => {
    for (const value of [undefined, null, 2130706433, ["127.0.0.1"], { address: "127.0.0.1" }]) {
      expect(canonicalAddress(value as never)).toBeUndefined();
      expect(classifyAddress(value as never)).toBe("refused");
    }
  });
});

describe("what an address is, whatever the form it is written in", () => {
  it.each([
    // The unspecified addresses, and the rest of 0.0.0.0/8.
    "0.0.0.0",
    "0.0.0.1",
    "0.255.255.255",
    "::",
    "0:0:0:0:0:0:0:0",
    "0000:0000:0000:0000:0000:0000:0000:0000",
    "::0.0.0.0",
    // Link-local: 169.254.0.0/16, where the metadata services of the clouds are, and fe80::/10.
    "169.254.0.0",
    "169.254.169.254",
    "169.254.255.255",
    "fe80::",
    "fe80::1",
    "FE80::1",
    "fe80:0:0:0:0:0:0:1",
    "fe80:0000:0000:0000:0000:0000:0000:0001",
    "fe81::1",
    "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    // Multicast, 224.0.0.0/4 and ff00::/8, and what is after it in IPv4, 240.0.0.0/4.
    "224.0.0.0",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.0",
    "255.255.255.255",
    "ff00::",
    "ff02::1",
    "FF02:0:0:0:0:0:0:1",
    "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    // The two metadata addresses that are not link-local.
    "168.63.129.16",
    "fd00:ec2::",
    "fd00:ec2::254",
    "FD00:EC2::254",
    "fd00:0ec2:0:0:0:0:0:254",
    "fd00:0ec2:0000:0000:0000:0000:0000:0254",
    "fd00:ec2:ffff:ffff:ffff:ffff:ffff:ffff",
    // An IPv4 address that is refused, carried by an IPv6 one: mapped, then translated.
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::FFFF:A9FE:A9FE",
    "0:0:0:0:0:ffff:a9fe:a9fe",
    "0000:0000:0000:0000:0000:ffff:169.254.169.254",
    "::ffff:0.0.0.0",
    "::ffff:224.0.0.1",
    "::ffff:240.0.0.1",
    "::ffff:168.63.129.16",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::169.254.169.254",
    "64:FF9B::A9FE:A9FE",
    "64:ff9b:0:0:0:0:a9fe:a9fe",
    "0064:ff9b:0000:0000:0000:0000:a9fe:a9fe",
    "64:ff9b::",
    "64:ff9b::e000:1",
    "64:ff9b::a83f:8110",
    // The loopback of a translator is not the one of this machine.
    "64:ff9b::7f00:1",
    "64:ff9b::127.0.0.1",
  ])("refuses %s", (address) => {
    expect(classifyAddress(address)).toBe("refused");
  });

  it.each([
    "127.0.0.0",
    "127.0.0.1",
    "127.1.2.3",
    "127.255.255.255",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::0001",
    "0000:0000:0000:0000:0000:0000:0000:0001",
    "0::1",
    "::0.0.0.1",
    // The loopback of IPv4 on a socket of IPv6.
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:FFFF:7F00:0001",
  ])("takes %s for the loopback", (address) => {
    expect(classifyAddress(address)).toBe("loopback");
  });

  it.each([
    "10.0.0.0",
    "10.1.2.3",
    "10.255.255.255",
    "172.16.0.0",
    "172.31.255.255",
    "192.168.0.0",
    "192.168.255.255",
    "100.64.0.0",
    "100.127.255.255",
    "198.18.0.0",
    "198.19.255.255",
    "fc00::",
    "fc00::1",
    "fd12:3456:789a::1",
    "FD12:3456:789A::1",
    "fd12:3456:789a:0:0:0:0:1",
    "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    // The two networks beside the one of the metadata address.
    "fd00:ec1:ffff:ffff:ffff:ffff:ffff:ffff",
    "fd00:ec3::",
    "fd00::ec2:0:0:254",
    // A private IPv4 address carried by an IPv6 one.
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "::ffff:192.168.1.1",
    "64:ff9b::10.0.0.1",
    "64:ff9b::c0a8:101",
  ])("takes %s for a private address", (address) => {
    expect(classifyAddress(address)).toBe("private");
  });

  it.each([
    "1.0.0.0",
    "8.8.8.8",
    "9.255.255.255",
    "11.0.0.0",
    "100.63.255.255",
    "100.128.0.0",
    "126.255.255.255",
    "128.0.0.0",
    "168.63.129.15",
    "168.63.129.17",
    "169.253.255.255",
    "169.255.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "192.167.255.255",
    "192.169.0.0",
    "198.17.255.255",
    "198.20.0.0",
    "223.255.255.255",
    "2001:db8::1",
    "2001:DB8:0:0:0:0:0:1",
    "2606:4700:4700::1111",
    "fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fe00::",
    "fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fec0::",
    "feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    // A public IPv4 address carried by an IPv6 one.
    "::ffff:8.8.8.8",
    "::ffff:808:808",
    "64:ff9b::8.8.8.8",
    "64:ff9b::808:808",
    // The prefix of a translator, one bit away.
    "64:ff9a::a9fe:a9fe",
    "64:ff9b:0:0:0:1:a9fe:a9fe",
  ])("takes %s for a public address", (address) => {
    expect(classifyAddress(address)).toBe("public");
  });

  it("gives every written form of an address the same answer", () => {
    for (const forms of [
      ["::1", "0:0:0:0:0:0:0:1", "::0001", "0000:0000:0000:0000:0000:0000:0000:0001", "::0.0.0.1"],
      ["fd00:ec2::254", "FD00:EC2::254", "fd00:0ec2:0:0:0:0:0:254", "fd00:ec2:0::0.0.2.84"],
      ["64:ff9b::a9fe:a9fe", "64:FF9B::169.254.169.254", "0064:ff9b:0:0:0:0:a9fe:a9fe"],
      ["::ffff:10.0.0.1", "::FFFF:A00:1", "0:0:0:0:0:ffff:10.0.0.1"],
      ["2001:db8::1", "2001:DB8::1", "2001:0db8:0:0:0:0:0:1", "2001:db8::0.0.0.1"],
    ]) {
      expect(new Set(forms.map(canonicalAddress)).size).toBe(1);
      expect(new Set(forms.map(classifyAddress)).size).toBe(1);
    }
  });
});

describe("the addresses the clouds serve their metadata at, in the ranges that are not refused", () => {
  // Each is inside a range a store may be in, private or public: the address itself is never connected to,
  // in any written form, with or without an allowance.
  it.each([
    "100.100.100.200",
    "192.0.0.192",
    "fd20:ce::254",
    "FD20:CE:0:0:0:0:0:254",
    "fd00:a9fe:a9fe::1",
    "::ffff:100.100.100.200",
    "::ffff:c000:c0",
    "64:ff9b::192.0.0.192",
  ])("refuses %s", (address) => {
    expect(classifyAddress(address)).toBe("refused");
  });

  it("leaves the addresses beside them what their range is", () => {
    expect(classifyAddress("100.100.100.201")).toBe("private");
    expect(classifyAddress("192.0.0.193")).toBe("public");
    expect(classifyAddress("fd20:ce::255")).toBe("private");
    expect(classifyAddress("fd00:a9fe:a9fe::2")).toBe("private");
  });
});

describe("an address a translator of a network of its own carries", () => {
  // The prefix a network uses for a translator of its own, 64:ff9b:1::/48: the IPv4 address in its last
  // two groups is what is reached, and the rules of IPv4 are asked of it.
  it.each([
    ["64:ff9b:1::a9fe:a9fe", "refused"],
    ["64:ff9b:1::169.254.169.254", "refused"],
    ["64:ff9b:1::7f00:1", "refused"],
    ["64:ff9b:1:abcd::0.0.0.0", "refused"],
    ["64:ff9b:1::10.0.0.1", "private"],
    ["64:ff9b:1::8.8.8.8", "public"],
  ])("reads %s as %s", (address, kind) => {
    expect(classifyAddress(address)).toBe(kind);
  });

  it("reads the prefix beside it as any other address", () => {
    expect(classifyAddress("64:ff9b:2::a9fe:a9fe")).toBe("public");
  });
});

describe("an address of IPv6 that carries an IPv4 one without saying how", () => {
  // The addresses of ::/96 the standard took back: an IPv4 address after ninety-six zeros, which no rule
  // of IPv4 would be asked about, and no store is at.
  it.each(["::127.0.0.1", "::7f00:1", "::169.254.169.254", "::10.0.0.1", "0:0:0:0:0:0:a00:1", "::2", "::ffff"])(
    "refuses %s",
    (address) => {
      expect(classifyAddress(address)).toBe("refused");
    },
  );

  it("still reads the two addresses of that range that are themselves", () => {
    expect(classifyAddress("::1")).toBe("loopback");
    expect(classifyAddress("::")).toBe("refused");
    // One group more, and it is an address like any other.
    expect(classifyAddress("0:0:0:0:0:1::1")).toBe("public");
  });
});

describe("the name of a metadata service", () => {
  it.each([
    "metadata.google.internal",
    "metadata.google.internal.",
    "METADATA.GOOGLE.INTERNAL",
    "Metadata.Google.Internal.",
  ])("knows %s", (host) => {
    expect(isMetadataName(host)).toBe(true);
  });

  it.each([
    "",
    "metadata",
    "google.internal",
    "metadata.google.internal..",
    ".metadata.google.internal",
    "xmetadata.google.internal",
    "metadata.google.internal.example",
    "metadata.google.internal ",
    "storage.example.invalid",
  ])("takes %j for another name", (host) => {
    expect(isMetadataName(host)).toBe(false);
  });
});
