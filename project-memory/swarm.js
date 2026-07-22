/**
 * Multi-Agent Swarm Memory Stream for project-memory.
 * Allows peer subagents (Antigravity, Hermes, Codex, Claude Code, Cursor)
 * to broadcast and query events in a shared project workspace.
 */

import fs from "fs/promises";
import path from "path";

const SWARM_FILE = ".swarm-events.jsonl";

function getSwarmPath(vaultDir) {
  return path.join(vaultDir, SWARM_FILE);
}

/**
 * Broadcast an event to the shared workspace swarm stream.
 */
export async function broadcastSwarmEvent(vaultDir, { eventType, topic, payload, agentName = "agent" }) {
  if (!vaultDir) throw new Error("vaultDir is required");
  const event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    agentName,
    eventType: eventType || "finding",
    topic: topic || "general",
    payload: payload || {},
  };

  const file = getSwarmPath(vaultDir);
  const line = JSON.stringify(event) + "\n";
  await fs.appendFile(file, line, "utf8");
  return event;
}

/**
 * Query recent swarm events in the workspace.
 */
export async function getSwarmTimeline(vaultDir, { limit = 20, eventType = null } = {}) {
  if (!vaultDir) return [];
  const file = getSwarmPath(vaultDir);
  try {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    let events = lines.map((l) => JSON.parse(l));

    if (eventType) {
      events = events.filter((e) => e.eventType === eventType);
    }

    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return events.slice(0, limit);
  } catch {
    return [];
  }
}
