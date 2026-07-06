module.exports = {
  apps: [
    {
      name: "server",
      script: "bun",
      args: ["run", "apps/server/src/index.ts"],
      cwd: "/app",
      autorestart: true,
      env: {
        NODE_ENV: "production",
        NAKAMA_HOST: "0.0.0.0",
        NAKAMA_PORT: "4310",
      },
    },
  ],
};
