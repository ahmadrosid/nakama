type ErrorWriter = (...args: unknown[]) => void;

const INIT_QUERY_ERROR = "unexpected error in 'init queries'";

export function createBaileysLogger(
  writeError: ErrorWriter = console.error.bind(console)
) {
  const noop = () => {};
  const logger = {
    child: () => logger,
    debug: noop,
    error: (...args: unknown[]) => {
      const [context, message] = args;
      if (isInitQueryTimeout(context, message)) {
        return;
      }

      writeError(...args);
    },
    fatal: writeError,
    info: noop,
    level: "silent",
    trace: noop,
    warn: console.warn.bind(console),
  };

  return logger;
}

function isInitQueryTimeout(context: unknown, message: unknown): boolean {
  if (
    message !== INIT_QUERY_ERROR ||
    typeof context !== "object" ||
    context === null ||
    !("err" in context)
  ) {
    return false;
  }

  const error = context.err;
  return (
    typeof error === "object" &&
    error !== null &&
    "isBoom" in error &&
    error.isBoom === true &&
    "message" in error &&
    error.message === "Timed Out"
  );
}
