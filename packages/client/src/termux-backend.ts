import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import { OpenPetsClientError, type OpenPetsReaction } from "./protocol.js";

type LeaseRecord = {
  readonly leaseId: string;
  readonly expiresAt: number;
};

const leaseTtlMs = 15_000;
const leaseStore = new Map<string, LeaseRecord>();

export function isTermuxEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.TERMUX_VERSION === "string" && env.TERMUX_VERSION.length > 0;
}

export function shouldUseTermuxBackend(env: NodeJS.ProcessEnv = process.env): boolean {
  const requested = env.OPENPETS_BACKEND?.trim().toLowerCase();
  if (requested === "termux") return true;
  if (requested === "ipc") return false;
  return isTermuxEnvironment(env);
}

export function getTermuxBackendStatus(leaseId?: string): Record<string, unknown> {
  if (leaseId) {
    const lease = leaseStore.get(leaseId);
    if (!lease || lease.expiresAt <= Date.now()) {
      leaseStore.delete(leaseId);
      return {
        ok: false,
        appRunning: true,
        leaseActive: false,
        leaseId,
        staleReason: "unknown_lease",
        backend: "termux",
      };
    }

    return {
      ok: true,
      appRunning: true,
      leaseId,
      leaseActive: true,
      backend: "termux",
      protocolVersion: 1,
      actualTargetPetId: "termux-notification",
      actualTargetPetName: "Termux Notifications",
      usingDefaultPet: true,
      defaultPet: {
        id: "termux-notification",
        displayName: "Termux Notifications",
        builtIn: true,
        broken: false,
      },
    };
  }

  return {
    ok: true,
    appRunning: true,
    backend: "termux",
    protocolVersion: 1,
    defaultPet: {
      id: "termux-notification",
      displayName: "Termux Notifications",
      builtIn: true,
      broken: false,
    },
    speechBubblesEnabled: true,
  };
}

export function acquireTermuxLease(requestedPetId?: string) {
  const leaseId = randomUUID();
  const expiresAt = Date.now() + leaseTtlMs;
  leaseStore.set(leaseId, { leaseId, expiresAt });
  return {
    leaseId,
    requestedPetId,
    targetKind: "default" as const,
    actualTargetPetId: "termux-notification",
    actualTargetPetName: "Termux Notifications",
    usingDefaultPet: true,
    expiresAt,
    leaseActive: true,
  };
}

export function heartbeatTermuxLease(leaseId: string) {
  const lease = leaseStore.get(leaseId);
  if (!lease || lease.expiresAt <= Date.now()) {
    leaseStore.delete(leaseId);
    throw new OpenPetsClientError("unknown_lease", "Unknown or expired lease.");
  }

  const expiresAt = Date.now() + leaseTtlMs;
  leaseStore.set(leaseId, { leaseId, expiresAt });
  return { leaseId, expiresAt };
}

export function releaseTermuxLease(leaseId: string) {
  const existed = leaseStore.delete(leaseId);
  return { released: existed };
}

export async function sendTermuxReaction(reaction: OpenPetsReaction): Promise<{ readonly ok: true; readonly backend: "termux"; readonly shown: true; readonly reaction: OpenPetsReaction }> {
  const content = reactionToMessage(reaction);
  await sendTermuxNotification("OpenPets", content, reaction);
  return { ok: true, backend: "termux", shown: true, reaction };
}

export async function sendTermuxMessage(message: string, reaction?: OpenPetsReaction): Promise<{ readonly ok: true; readonly backend: "termux"; readonly shown: true; readonly reaction?: OpenPetsReaction }> {
  const safeMessage = sanitizeNotificationText(message);
  if (!safeMessage) {
    throw new OpenPetsClientError("invalid_params", "Notification message must be non-empty.");
  }

  const title = reaction ? `OpenPets - ${reaction}` : "OpenPets";
  await sendTermuxNotification(title, safeMessage, reaction);
  return { ok: true, backend: "termux", shown: true, reaction };
}

async function sendTermuxNotification(title: string, content: string, reaction?: OpenPetsReaction): Promise<void> {
  const safeTitle = sanitizeNotificationText(title, 60) || "OpenPets";
  const safeContent = sanitizeNotificationText(content, 220);
  if (!safeContent) {
    throw new OpenPetsClientError("invalid_params", "Notification content must be non-empty.");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("termux-notification", [
      "--id", "openpets",
      "--title", safeTitle,
      "--content", safeContent,
      "--priority", reactionToPriority(reaction),
      "--icon", "pets",
    ], { stdio: "ignore" });

    child.once("error", () => {
      reject(new OpenPetsClientError("unavailable", "termux-notification is unavailable. Install Termux:API and termux-api package."));
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new OpenPetsClientError("unavailable", "termux-notification failed. Ensure Termux:API app and permissions are enabled."));
    });
  });
}

function sanitizeNotificationText(value: string, maxLength = 140): string {
  return value.replace(/[\x00-\x1F\x7F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function reactionToPriority(reaction?: OpenPetsReaction): "default" | "high" | "max" {
  if (reaction === "error") return "max";
  if (reaction === "waiting" || reaction === "testing") return "high";
  return "default";
}

function reactionToMessage(reaction: OpenPetsReaction): string {
  switch (reaction) {
    case "thinking": return "Thinking...";
    case "working": return "Working...";
    case "editing": return "Editing files...";
    case "running": return "Running command...";
    case "testing": return "Running tests...";
    case "waiting": return "Waiting for approval.";
    case "waving": return "Hello from OpenPets.";
    case "success": return "Task completed.";
    case "error": return "Something failed.";
    case "celebrating": return "Great job!";
    default: return "OpenPets update.";
  }
}
