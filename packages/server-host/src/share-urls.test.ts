import { describe, expect, it } from "bun:test";
import {
  buildLanShareUrls,
  discoveryAdvertiseHost,
  isLocalOnlyBind,
  resolveShareUrls,
} from "./share-urls.js";

describe("share-urls", () => {
  it("marks loopback bind as local only", () => {
    expect(isLocalOnlyBind("127.0.0.1")).toBe(true);
    expect(buildLanShareUrls("127.0.0.1", 8080)).toEqual([]);
  });

  it("uses explicit bind host for LAN URL", () => {
    expect(buildLanShareUrls("192.168.1.10", 8080)).toEqual(["http://192.168.1.10:8080"]);
  });

  it("builds WAN URL from public IP when not local only", async () => {
    const urls = await resolveShareUrls("0.0.0.0", 9090, async () => "203.0.113.5");
    expect(urls.local_only).toBe(false);
    expect(urls.wan).toBe("http://203.0.113.5:9090");
  });

  it("skips WAN when bound to localhost", async () => {
    const urls = await resolveShareUrls("127.0.0.1", 8080, async () => "203.0.113.5");
    expect(urls.local_only).toBe(true);
    expect(urls.wan).toBeNull();
  });

  it("advertises a LAN IP for wildcard discovery bind", () => {
    const host = discoveryAdvertiseHost("0.0.0.0");
    expect(host).not.toBe("0.0.0.0");
    expect(isLocalOnlyBind(host)).toBe(false);
  });
});
