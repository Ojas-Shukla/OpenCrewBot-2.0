#!/usr/bin/env node
// Standalone scheduler daemon that can run as an independent long-lived worker
// (e.g. systemd, PM2, Docker container) independent of HTTP request lifecycles.
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env")) {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = (match[2] || "").trim().replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {
    // ignore
  }
}

const baseUrl = process.env.OPENCREWBOT_URL || "http://127.0.0.1:3000";
const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 30000);
const secret = process.env.CRON_SECRET;

console.log(`[scheduler-daemon] Started workflow scheduler daemon targeting ${baseUrl}`);
if (!secret) {
  console.warn("[scheduler-daemon] Warning: CRON_SECRET is not set in environment or .env. The cron endpoint requires authentication.");
}

process.on("SIGINT", () => {
  console.log("\n[scheduler-daemon] Shutting down...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("\n[scheduler-daemon] Shutting down...");
  process.exit(0);
});

async function tick() {
  try {
    const headers = { "Content-Type": "application/json" };
    if (secret) headers["Authorization"] = `Bearer ${secret}`;
    const res = await fetch(`${baseUrl}/api/workflows/cron`, { method: "POST", headers });
    if (res.ok) {
      const data = await res.json();
      if (data.triggered?.length) {
        console.log(`[scheduler-daemon] Triggered: ${data.triggered.join(", ")}`);
      }
    } else {
      console.warn(`[scheduler-daemon] HTTP ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[scheduler-daemon] Connection error: ${err.message}`);
  }
}

void tick();
setInterval(tick, intervalMs);
