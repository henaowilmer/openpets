import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { parseMcpArgs } from "./args.js";
import { createOpenPetsMcpServer } from "./server.js";
import { createMcpStatus, sanitizeUnavailableReason, type OpenPetsMcpStatus } from "./tools.js";

parseMcpArgs(["--pet", "snoopy"]);
parseMcpArgs(["--pet=snoopy"]);
parseMcpArgs(["--backend", "termux"]);
parseMcpArgs(["--backend=ipc"]);
parseMcpArgs(["--pet", "Bad Pet"]);
parseMcpArgs(["--help"]);
assertRejects(() => parseMcpArgs(["--pet", "bad/pet"]));
assertRejects(() => parseMcpArgs(["--backend", "bad"]));
assertRejects(() => parseMcpArgs(["--agent", "claude"]));

const unavailableStatus = createMcpStatus({ ok: false, appRunning: false, unavailableReason: "/Users/alvin/.config/OpenPets/runtime/ipc.json ENOENT" }, "snoopy");
if (unavailableStatus.routingImplemented !== true || unavailableStatus.configuredPetId !== "snoopy") {
  throw new Error("MCP status did not preserve configured pet during degraded status.");
}
if (unavailableStatus.unavailableReason?.includes("/Users/")) {
  throw new Error("Unavailable reason leaked a local path.");
}
if (sanitizeUnavailableReason("/tmp/openpets-501/openpets-1.sock ENOENT")?.includes("/tmp")) {
  throw new Error("Sanitizer leaked socket path.");
}

await checkMcpServerContract();
await checkStdioServerContract();
const builtEntrypoint = readFileSync(join("dist", "index.js"), "utf8");
if (!builtEntrypoint.startsWith("#!/usr/bin/env node")) {
  throw new Error("Built MCP entrypoint is missing a Node shebang.");
}

console.error("MCP contract validation passed.");

async function checkMcpServerContract(): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const fakeClient = {
    status: async () => ({ ok: true, appRunning: true, defaultPet: { id: "snoopy", displayName: "Snoopy" } }),
    listPets: async () => ({ ok: true as const, pets: [], defaultPetId: "builtin" }),
    installPet: async () => { throw new Error("unused"); },
    acquireLease: async () => ({ leaseId: "lease-1", requestedPetId: "snoopy", targetKind: "explicit" as const, actualTargetPetId: "snoopy", actualTargetPetName: "Snoopy", usingDefaultPet: false, expiresAt: Date.now() + 15_000, leaseActive: true }),
    heartbeatLease: async (leaseId: string) => ({ leaseId, expiresAt: Date.now() + 15_000 }),
    releaseLease: async () => ({ released: true }),
    react: async (reaction: string, options?: { readonly leaseId?: string }) => ({ ok: true, reaction, leaseId: options?.leaseId }),
    say: async (message: string, options?: { readonly leaseId?: string }) => ({ ok: true, message, leaseId: options?.leaseId }),
    hello: async () => ({ ok: true }),
  };
  const server = createOpenPetsMcpServer({ configuredPetId: "snoopy", client: fakeClient, lease: { lease: await fakeClient.acquireLease() }, leaseReady: Promise.resolve() });
  const client = new Client({ name: "openpets-contract", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    if (names.join(",") !== "openpets_react,openpets_say,openpets_status") {
      throw new Error(`Unexpected MCP tool list: ${names.join(",")}`);
    }

    const status = await client.callTool({ name: "openpets_status", arguments: {} }, CallToolResultSchema);
    const structured = status.structuredContent as unknown as OpenPetsMcpStatus;
    if (!structured.ok || structured.configuredPetId !== "snoopy" || structured.routingImplemented !== true || structured.actualTargetPetId !== "snoopy") {
      throw new Error("Status tool returned unexpected structured content.");
    }

    const react = await client.callTool({ name: "openpets_react", arguments: { reaction: "waving" } }, CallToolResultSchema);
    if (react.isError) throw new Error("Valid reaction unexpectedly failed.");
    const reactStructured = react.structuredContent as { readonly result?: { readonly leaseId?: string } } | undefined;
    if (reactStructured?.result?.leaseId !== "lease-1") throw new Error("Reaction did not pass lease id to client.");

    const invalidReact = await client.callTool({ name: "openpets_react", arguments: { reaction: "bad" } }, CallToolResultSchema);
    if (!invalidReact.isError) throw new Error("Invalid reaction was not rejected.");

    const invalidSay = await client.callTool({ name: "openpets_say", arguments: { message: "const secret = 1" } }, CallToolResultSchema);
    if (!invalidSay.isError) throw new Error("Unsafe say message was not rejected.");

    const stale = createMcpStatus({ ok: false, appRunning: true, leaseId: "missing", leaseActive: false, staleReason: "unknown_lease" }, "snoopy", undefined, "missing", "missing");
    if (stale.leaseActive !== false || stale.staleReason !== "unknown_lease" || stale.ok !== false) {
      throw new Error("Stale MCP lease status was not preserved.");
    }
  } finally {
    await client.close();
    await server.close();
  }
}

async function checkStdioServerContract(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join("dist", "index.js"), "--pet", "snoopy"],
    env: { ...process.env, OPENPETS_DISCOVERY_FILE: join(process.cwd(), ".missing-openpets-discovery.json"), OPENPETS_BACKEND: "ipc" },
    stderr: "pipe",
  });
  const client = new Client({ name: "openpets-stdio-contract", version: "0.0.0" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    if (names.join(",") !== "openpets_react,openpets_say,openpets_status") {
      throw new Error(`Unexpected stdio MCP tool list: ${names.join(",")}`);
    }

    const status = await client.callTool({ name: "openpets_status", arguments: {} }, CallToolResultSchema);
    const content = Array.isArray(status.content) ? status.content : [];
    const first = content[0] as { readonly type?: unknown; readonly text?: unknown } | undefined;
    const text = first?.type === "text" && typeof first.text === "string" ? first.text : "";
    if (!text.includes("Configured --pet snoopy") || !text.includes("actual target is unavailable")) {
      throw new Error("Unavailable stdio status did not explain configured pet and unavailable target.");
    }
    const structured = status.structuredContent as unknown as OpenPetsMcpStatus;
    if (structured.appRunning !== false || structured.configuredPetId !== "snoopy" || structured.routingImplemented !== true) {
      throw new Error("Unavailable stdio status returned unexpected structured content.");
    }
  } finally {
    await client.close();
  }
}

function assertRejects(callback: () => unknown): void {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error("Expected validation to reject.");
}
