import test from "node:test";
import assert from "node:assert/strict";
import { devTunnelOrigin } from "../src/server/lib/common.js";

const env = {
  LOCAL_DEV: "1",
  NODE_ENV: "development",
  ASHA_DEV_ORIGINS: "calm-lake-1234.trycloudflare.com, other.example",
};

test("A listed tunnel host is allowed for the local dev server", () => {
  assert.equal(
    devTunnelOrigin("https://calm-lake-1234.trycloudflare.com", env),
    true,
  );
  assert.equal(devTunnelOrigin("https://other.example", env), true);
});

test("Unlisted hosts, plain http and look-alike hosts are refused", () => {
  assert.equal(devTunnelOrigin("https://evil.trycloudflare.com", env), false);
  assert.equal(
    devTunnelOrigin("http://calm-lake-1234.trycloudflare.com", env),
    false,
  );
  assert.equal(
    devTunnelOrigin("https://calm-lake-1234.trycloudflare.com.evil.io", env),
    false,
  );
  assert.equal(devTunnelOrigin(undefined, env), false);
});

test("Tunnel hosts are ignored in production and without LOCAL_DEV", () => {
  assert.equal(
    devTunnelOrigin("https://calm-lake-1234.trycloudflare.com", {
      ...env,
      NODE_ENV: "production",
    }),
    false,
  );
  assert.equal(
    devTunnelOrigin("https://calm-lake-1234.trycloudflare.com", {
      ...env,
      LOCAL_DEV: undefined,
    }),
    false,
  );
});
