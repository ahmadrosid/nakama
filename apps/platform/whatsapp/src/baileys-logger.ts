type ErrorWriter = (...args: unknown[]) => void;

interface MutableConsoleTarget {
  info: ErrorWriter;
  warn: ErrorWriter;
}

const INIT_QUERY_ERROR = "unexpected error in 'init queries'";
const CLOSING_SIGNAL_SESSION = "Closing session:";
const CLOSED_SIGNAL_SESSION = "Session already closed";

export function installBaileysConsoleRedaction(
  target: MutableConsoleTarget = console
): () => void {
  const originalInfo = target.info;
  const originalWarn = target.warn;
  const redactedInfo: ErrorWriter = (...args) => {
    if (args[0] === CLOSING_SIGNAL_SESSION) {
      originalInfo.call(target, "Closing Signal session.");
      return;
    }

    originalInfo.apply(target, args);
  };
  const redactedWarn: ErrorWriter = (...args) => {
    if (args[0] === CLOSED_SIGNAL_SESSION) {
      originalWarn.call(target, "Signal session already closed.");
      return;
    }

    originalWarn.apply(target, args);
  };

  target.info = redactedInfo;
  target.warn = redactedWarn;

  return () => {
    if (target.info === redactedInfo) {
      target.info = originalInfo;
    }
    if (target.warn === redactedWarn) {
      target.warn = originalWarn;
    }
  };
}

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
