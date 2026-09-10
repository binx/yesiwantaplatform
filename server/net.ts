import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * The address guard: refuse to have the server talk to anything private.
 *
 * Lifted out of Beluga's outbound-webhook module, which is gone; the font
 * stylesheet fetch in server/fonts.ts still needs it, because a merchant
 * pasting a URL the server then fetches is an SSRF primitive unless the
 * target is checked against the address it *resolves to*.
 */

export class HostNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostNotAllowedError";
  }
}

function ipv4IsPrivate(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local — the cloud metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast and reserved

  return false;
}

/** Is this address one the host should refuse to talk to? Unknown shapes count as private. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipv4IsPrivate(address);
  if (version !== 6) return true;

  const value = address.toLowerCase().split("%")[0] ?? "";

  const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (embedded?.[1]) return ipv4IsPrivate(embedded[1]);

  if (value === "::" || value === "::1") return true;
  if (/^f[cd]/.test(value)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(value)) return true; // fe80::/10 link-local
  if (/^ff/.test(value)) return true; // multicast
  if (value.startsWith("2001:db8")) return true; // documentation

  return false;
}

/**
 * Resolve a hostname and refuse anything private or reserved. Every answer
 * must be acceptable, not just the first: a hostname with both a public and a
 * loopback record would otherwise get through on a coin flip.
 */
export async function assertPublicHostname(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");

  let addresses: { address: string }[];
  if (isIP(host)) {
    addresses = [{ address: host }];
  } else {
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new HostNotAllowedError(`${hostname} does not resolve.`);
    }
  }

  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new HostNotAllowedError(`${hostname} resolves to a private or reserved address.`);
  }
}
