import assert from "node:assert/strict";

import { parseIpcEndpoint, validateDiscovery } from "../src/discovery.js";
import { parsePetInstallResult, parsePetListResult } from "../src/index.js";
import { OpenPetsClientError, parseIpcResponse, validateReaction } from "../src/protocol.js";
import { isTermuxEnvironment, shouldUseTermuxBackend } from "../src/termux-backend.js";

const baseDiscovery = {
  protocolVersion: 1,
  protocol: "openpets-ipc",
  endpoint: process.platform === "win32" ? "\\\\.\\pipe\\openpets-abc-123" : "/tmp/openpets-501/openpets-123.sock",
  token: "x".repeat(32),
  appVersion: "0.0.0",
  pid: 123,
  platform: process.platform === "android" ? "linux" : process.platform,
};

validateDiscovery(baseDiscovery);
validateDiscovery({ ...baseDiscovery, endpoint: "tcp://127.0.0.1:37645" });
assert.deepEqual(parseIpcEndpoint("tcp://127.0.0.1:37645"), { kind: "tcp", host: "127.0.0.1", port: 37645 });

// Test private/local IPv4 addresses for WSL NAT mode
assert.deepEqual(parseIpcEndpoint("tcp://10.0.0.1:37645"), { kind: "tcp", host: "10.0.0.1", port: 37645 });
assert.deepEqual(parseIpcEndpoint("tcp://172.16.0.1:37645"), { kind: "tcp", host: "172.16.0.1", port: 37645 });
assert.deepEqual(parseIpcEndpoint("tcp://172.31.255.255:37645"), { kind: "tcp", host: "172.31.255.255", port: 37645 });
assert.deepEqual(parseIpcEndpoint("tcp://192.168.1.1:37645"), { kind: "tcp", host: "192.168.1.1", port: 37645 });
assert.deepEqual(parseIpcEndpoint("tcp://169.254.1.1:37645"), { kind: "tcp", host: "169.254.1.1", port: 37645 });

// Test cross-platform discovery with private IPs (Windows desktop -> WSL client)
if (process.platform === "linux") {
  validateDiscovery({ ...baseDiscovery, endpoint: "tcp://192.168.1.100:37645", platform: "win32" });
  validateDiscovery({ ...baseDiscovery, endpoint: "tcp://172.25.32.1:37645", platform: "win32" });
}

assertRejects(() => validateDiscovery({ ...baseDiscovery, protocol: "http" }));
assertRejects(() => validateDiscovery({ ...baseDiscovery, protocolVersion: 2 }));
assertRejects(() => validateDiscovery({ ...baseDiscovery, endpoint: "127.0.0.1:1234" }));
assertRejects(() => validateDiscovery({ ...baseDiscovery, endpoint: "tcp://localhost:37645" }));
assertRejects(() => validateDiscovery({ ...baseDiscovery, endpoint: "tcp://0.0.0.0:37645" }));
assertRejects(() => validateDiscovery({ ...baseDiscovery, endpoint: "tcp://127.0.0.1:0" }));
assertRejects(() => validateDiscovery({ ...baseDiscovery, endpoint: "tcp://127.0.0.1:37645/path" }));
assertRejects(() => validateDiscovery({ ...baseDiscovery, endpoint: "tcp://user:pass@127.0.0.1:37645" }));
assertRejects(() => validateDiscovery({ ...baseDiscovery, platform: "freebsd" }));

// Reject public IPs
assertRejects(() => validateDiscovery({ ...baseDiscovery, endpoint: "tcp://8.8.8.8:37645" }));
assertRejects(() => validateDiscovery({ ...baseDiscovery, endpoint: "tcp://1.2.3.4:37645" }));
assertRejects(() => validateDiscovery({ ...baseDiscovery, endpoint: "tcp://172.15.0.1:37645" })); // Just outside private range
assertRejects(() => validateDiscovery({ ...baseDiscovery, endpoint: "tcp://172.32.0.1:37645" })); // Just outside private range
assertRejects(() => validateDiscovery({ ...baseDiscovery, endpoint: "tcp://11.0.0.1:37645" })); // Not in 10.0.0.0/8

if (process.platform === "linux") {
  validateDiscovery({ ...baseDiscovery, endpoint: "tcp://127.0.0.1:37645", platform: "win32" });
  assertRejects(() => validateDiscovery({ ...baseDiscovery, platform: "win32" }));
}
assertRejects(() => validateReaction("bad"));
assert.equal(validateReaction("waving"), "waving");

const ok = parseIpcResponse<{ value: number }>({ id: "1", ok: true, result: { value: 1 } });
if (!ok.ok || ok.result.value !== 1) throw new Error("Failed to parse ok response.");

const err = parseIpcResponse({ id: "1", ok: false, error: { code: "invalid_token", message: "Invalid" } });
if (err.ok || err.error.code !== "invalid_token") throw new Error("Failed to parse error response.");

assertRejects(() => parseIpcResponse({ ok: true }));
assert.deepEqual(parsePetListResult({ ok: true, defaultPetId: "builtin", pets: [{ id: "fixer", displayName: "Fixer", builtIn: false, broken: false }] }), { ok: true, defaultPetId: "builtin", pets: [{ id: "fixer", displayName: "Fixer", builtIn: false, broken: false }] });
assertRejects(() => parsePetListResult({ ok: true, pets: [{ id: "fixer" }], defaultPetId: "builtin" }));
assert.deepEqual(parsePetInstallResult({ ok: true, petId: "fixer", displayName: "Fixer", installed: true }), { ok: true, petId: "fixer", displayName: "Fixer", installed: true });
assertRejects(() => parsePetInstallResult({ ok: true, petId: "fixer" }));

assert.equal(isTermuxEnvironment({ TERMUX_VERSION: "0.118.0" } as NodeJS.ProcessEnv), true);
assert.equal(isTermuxEnvironment({} as NodeJS.ProcessEnv), false);
assert.equal(shouldUseTermuxBackend({ OPENPETS_BACKEND: "termux" } as NodeJS.ProcessEnv), true);
assert.equal(shouldUseTermuxBackend({ OPENPETS_BACKEND: "ipc" } as NodeJS.ProcessEnv), false);
assert.equal(shouldUseTermuxBackend({ TERMUX_VERSION: "0.118.0" } as NodeJS.ProcessEnv), true);
assert.equal(shouldUseTermuxBackend({} as NodeJS.ProcessEnv), false);

console.log("Client protocol validation passed.");

function assertRejects(callback: () => unknown): void {
  try {
    callback();
  } catch (error) {
    if (error instanceof OpenPetsClientError || error instanceof Error) return;
  }
  throw new Error("Expected validation to reject.");
}
