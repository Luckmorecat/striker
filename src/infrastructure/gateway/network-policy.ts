import { networkInterfaces } from "node:os";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export interface NamedServiceGrant {
  readonly name: string;
  readonly port: number;
  readonly addresses: readonly string[];
}
export type ResolveAddresses = (hostname: string) => Promise<readonly string[]>;
const resolveAddresses: ResolveAddresses = async (hostname) =>
  (await lookup(hostname, { all: true })).map(({ address }) => address);

function interfaceAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap((items) =>
    (items ?? []).map((item) => item.address),
  );
}

export class NetworkPolicy {
  private readonly forbidden = new BlockList();
  private readonly globalV6 = new BlockList();

  constructor(
    private readonly grants: readonly NamedServiceGrant[],
    private readonly resolve: ResolveAddresses = resolveAddresses,
    private readonly hostAddresses: () => readonly string[] = interfaceAddresses,
  ) {
    for (const [address, prefix] of [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ] as const)
      this.forbidden.addSubnet(address, prefix, "ipv4");
    this.globalV6.addSubnet("2000::", 3, "ipv6");
    for (const [address, prefix] of [
      ["2001::", 23],
      ["2001:db8::", 32],
      ["2002::", 16],
      ["3fff::", 20],
    ] as const)
      this.forbidden.addSubnet(address, prefix, "ipv6");
  }

  async destination(
    input: string,
  ): Promise<{ hostname: string; address: string; port: number }> {
    const url = new URL(input);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    this.validateUrl(url);
    const grant = this.grants.find(
      (item) => item.name === hostname && item.port === port,
    );
    const addresses =
      grant?.addresses ??
      (isIP(hostname) ? [hostname] : await this.resolve(hostname));
    if (
      !grant &&
      ((port !== 80 && port !== 443) ||
        addresses.some((address) => !this.publicAddress(address)))
    )
      throw new Error("Forbidden destination");
    const address = addresses[0];
    if (!address || !isIP(address)) throw new Error("Forbidden destination");
    return { hostname, address, port };
  }

  private validateUrl(url: URL): void {
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Forbidden destination");
  }

  private publicAddress(address: string): boolean {
    const version = isIP(address);
    if (!version) return false;
    const type = version === 6 ? "ipv6" : "ipv4";
    if (version === 6 && !this.globalV6.check(address, "ipv6")) return false;
    return (
      !this.forbidden.check(address, type) && !this.isHostAddress(address, type)
    );
  }
  private isHostAddress(address: string, type: "ipv4" | "ipv6"): boolean {
    const hosts = new BlockList();
    for (const host of this.hostAddresses()) {
      const version = isIP(host);
      if (version) hosts.addAddress(host, version === 6 ? "ipv6" : "ipv4");
    }
    return hosts.check(address, type);
  }
}
