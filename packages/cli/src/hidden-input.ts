/** Read one secret from a terminal without echoing it or placing it in shell history. */
export function readHiddenLine(prompt: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new Error('Input cancelled.'));
  const input = process.stdin;
  if (!input.isTTY || !input.setRawMode) return Promise.reject(new Error('This command requires an interactive terminal.'));
  return new Promise((resolve, reject) => {
    let value = '';
    const previous = input.isRaw;
    const cleanup = () => {
      input.off('data', onData);
      signal?.removeEventListener('abort', onAbort);
      input.setRawMode(previous ?? false);
      input.pause();
      process.stderr.write('\n');
    };
    const onAbort = () => { cleanup(); reject(new Error('Input cancelled.')); };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) { cleanup(); reject(new Error('Input cancelled.')); return; }
        if (byte === 13 || byte === 10) { cleanup(); resolve(value); return; }
        if (byte === 127) value = value.slice(0, -1);
        else if (byte >= 32 && byte < 127 && value.length < 4096) value += String.fromCharCode(byte);
      }
    };
    process.stderr.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
