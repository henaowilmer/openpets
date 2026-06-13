#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createHelpText, parseMcpArgs } from "./args.js";
import { createOpenPetsMcpServer } from "./server.js";
import { createToolContext, type LeaseContext } from "./tools.js";

async function main(): Promise<void> {
  const options = parseMcpArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(createHelpText());
    return;
  }

  if (options.version) {
    process.stdout.write(`${readPackageVersion()}\n`);
    return;
  }

  const forcedBackend = options.backend ?? process.env.OPENPETS_BACKEND;
  if (forcedBackend) process.env.OPENPETS_BACKEND = forcedBackend;

  const lease: LeaseContext = {};
  const context = createToolContext(options.petId);
  const leaseReady = acquireStartupLease(context.client, lease, options.petId);
  const server = createOpenPetsMcpServer({ ...context, lease, leaseReady });
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let retryDelayMs = 5_000;
  const MAX_RETRY_DELAY_MS = 60_000;
  let closing = false;

  function scheduleRetry(): void {
    if (retryTimer || closing) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (closing || lease.lease) return;
      void context.client.acquireLease({ requestedPetId: options.petId }).then((result) => {
        lease.lease = result;
        lease.staleLeaseId = undefined;
        lease.degradedReason = undefined;
        retryDelayMs = 5_000;
      }).catch((error: unknown) => {
        lease.degradedReason = sanitizeMcpRuntimeError(error);
        retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
        scheduleRetry();
      });
    }, retryDelayMs);
    retryTimer.unref?.();
  }

  leaseReady.then(() => {
    if (!lease.lease) return;
    heartbeatTimer = setInterval(() => {
      if (closing || !lease.lease) return;
      void context.client.heartbeatLease(lease.lease.leaseId).catch((error: unknown) => {
        lease.staleLeaseId = lease.lease?.leaseId;
        lease.degradedReason = sanitizeMcpRuntimeError(error);
        lease.lease = undefined;
        retryDelayMs = 5_000;
        scheduleRetry();
      });
    }, 5_000);
    heartbeatTimer.unref?.();
  }).catch(() => {});
  const transport = new StdioServerTransport();
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    const leaseId = lease.lease?.leaseId;
    lease.lease = undefined;
    if (leaseId) {
      try { await context.client.releaseLease(leaseId); } catch { /* best effort */ }
    }
    try { await server.close(); } catch { /* ignore shutdown errors */ }
  };
  transport.onclose = () => { void close(); };

  process.on("SIGINT", () => { void close().finally(() => process.exit(0)); });
  process.on("SIGTERM", () => { void close().finally(() => process.exit(0)); });

  await server.connect(transport);
}

async function acquireStartupLease(client: ReturnType<typeof createToolContext>["client"], lease: LeaseContext, requestedPetId: string | undefined): Promise<void> {
  try {
    lease.lease = await client.acquireLease({ requestedPetId });
    lease.staleLeaseId = undefined;
    lease.degradedReason = undefined;
  } catch (error) {
    lease.lease = undefined;
    lease.staleLeaseId = undefined;
    lease.degradedReason = sanitizeMcpRuntimeError(error);
  }
}

function sanitizeMcpRuntimeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "OpenPets lease operation failed.";
  if (/\/|\\|\.sock|pipe|token|ipc\.json|ENOENT|ECONNREFUSED|EACCES/i.test(message)) {
    return "OpenPets desktop app or local IPC is unavailable.";
  }
  return message.slice(0, 160);
}

main().catch((error: unknown) => {
  process.stderr.write(`OpenPets MCP server failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
