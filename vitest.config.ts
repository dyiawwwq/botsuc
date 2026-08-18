import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DISCORD_BOT_TOKEN: "test-token-not-real",
      DISCORD_CLIENT_ID: "test-client-id",
      DATABASE_FILE: ":memory:",
      LOG_LEVEL: "error",
      ENABLE_MESSAGE_CONTENT_FEATURES: "false",
    },
  },
});
