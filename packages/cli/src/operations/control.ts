import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { CONTROL_MAX_BYTES, CONTROL_TIMEOUT_MS, CONTROL_VERSION, encodeControl, type ControlOperation, type ControlRequest, type ControlResponse } from '@vian/core';
import { socketPath } from '../local/common.ts';

export async function requestControl(operation: ControlOperation, bot?: string): Promise<ControlResponse> {
  const request: ControlRequest = { version: CONTROL_VERSION, requestId: randomUUID(), operation, ...(bot ? { bot } : {}) };
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath());
    let bytes = 0;
    let body = '';
    const timer = setTimeout(() => socket.destroy(new Error('Daemon control timed out')), CONTROL_TIMEOUT_MS);
    socket.on('connect', () => socket.write(encodeControl(request)));
    socket.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > CONTROL_MAX_BYTES) { socket.destroy(new Error('Daemon control frame is too large')); return; }
      body += chunk.toString('utf8');
      const newline = body.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(body.slice(0, newline)) as ControlResponse;
        if (response.version !== CONTROL_VERSION || response.requestId !== request.requestId || typeof response.ok !== 'boolean') throw new Error('Invalid daemon response');
        clearTimeout(timer); socket.end(); resolve(response);
      } catch (error) { socket.destroy(error as Error); }
    });
    socket.on('error', error => { clearTimeout(timer); reject(error); });
    socket.on('end', () => clearTimeout(timer));
  });
}
