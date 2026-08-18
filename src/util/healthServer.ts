import { createServer } from "node:http";
import { logger } from "./logger.js";

/**
 * Render's free Web Service tier requires a bound port (it health-checks
 * for one, and free instance-hours only count while it's listening) and
 * spins the service down after 15 minutes with no inbound HTTP traffic.
 * This bot has no web frontend of its own, so this server exists purely
 * to satisfy that port check and to give an external uptime pinger
 * (e.g. UptimeRobot, cron-job.org) something to hit every ~10-14 minutes
 * to prevent spin-down. It does not serve any bot functionality.
 */
export function startHealthServer() {
  const port = Number(process.env.PORT) || 3000;

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });

  server.listen(port, () => {
    logger.info({ port }, "Health-check server listening");
  });

  return server;
}
