"use strict";
module.exports = {
  apps: [
    {
      args: ["run", "apps/server/src/index.ts"],
      autorestart: true,
      cwd: "/app",
      env: {
        NAKAMA_HOST: "0.0.0.0",
        NAKAMA_PORT: "4310",
        NODE_ENV: "production",
      },
      name: "server",
      script: "bun",
    },
  ],
};
