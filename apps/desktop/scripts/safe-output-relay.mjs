const disconnectedOutputCodes = new Set(["EIO", "EPIPE"]);

export function isDisconnectedOutputError(cause) {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string" &&
    disconnectedOutputCodes.has(cause.code)
  );
}

function rethrowUnexpectedOutputError(cause) {
  queueMicrotask(() => {
    throw cause;
  });
}

/**
 * Forward a readable child stream while its destination is healthy. If a
 * terminal disappears, keep draining the child stream instead of leaving the
 * child process attached to a broken stdout/stderr file descriptor.
 */
export function createSafeOutputRelay(
  target,
  { onUnexpectedError = rethrowUnexpectedOutputError } = {},
) {
  let available = true;
  const sources = new Set();

  const disconnectSource = (source) => {
    if (!sources.delete(source)) return;
    source.unpipe(target);
    source.removeListener("end", onSourceEnd);
    source.removeListener("close", onSourceEnd);
    source.removeListener("error", onSourceError);
  };

  function onSourceEnd() {
    disconnectSource(this);
  }

  function onSourceError(cause) {
    disconnectSource(this);
    if (!isDisconnectedOutputError(cause)) onUnexpectedError(cause);
  }

  const disable = () => {
    if (!available) return;
    available = false;
    for (const source of sources) {
      disconnectSource(source);
      source.resume();
    }
  };

  const onTargetError = (cause) => {
    disable();
    if (!isDisconnectedOutputError(cause)) onUnexpectedError(cause);
  };

  target.on("error", onTargetError);

  return {
    get available() {
      return available;
    },
    connect(source) {
      if (!source) return () => undefined;
      if (!available) {
        source.resume();
        return () => undefined;
      }
      sources.add(source);
      source.once("end", onSourceEnd);
      source.once("close", onSourceEnd);
      source.once("error", onSourceError);
      source.pipe(target, { end: false });
      return () => disconnectSource(source);
    },
    dispose() {
      disable();
      target.removeListener("error", onTargetError);
    },
  };
}
