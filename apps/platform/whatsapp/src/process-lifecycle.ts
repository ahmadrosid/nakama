export function registerProcessLifecycleHandlers(
  cleanup: () => void | Promise<void>
): void {
  let shuttingDown = false;

  const shutdown = (exitCode: number): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    void (async () => {
      try {
        await cleanup();
      } finally {
        process.exit(exitCode);
      }
    })();
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      console.log(`WhatsApp worker received ${signal}. Shutting down.`);
      shutdown(0);
    });
  }

  process.on("uncaughtException", (error) => {
    console.error("WhatsApp worker uncaught exception.", error);
    shutdown(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("WhatsApp worker unhandled rejection.", reason);
  });

  process.on("exit", (code) => {
    console.log(`WhatsApp worker exiting with code ${code}.`);
  });
}
