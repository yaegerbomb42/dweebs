import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import { NetClient } from '../src/net/NetClient.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn) {
  const deadline = Date.now() + 10000;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for mock server');
    await wait(20);
  }
}

it('starts a mock-sim match after the host changes lobby settings', async () => {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const server = spawn(process.execPath, ['server/index.js', '--port', String(port), '--sim', 'mock'], { stdio: 'ignore' });
  const oldWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = WebSocket;
  let client;
  try {
    let up = false;
    await waitFor(() => {
      if (!up) fetch(`http://127.0.0.1:${port}/healthz`).then(r => { up = r.ok; }).catch(() => {});
      return up;
    });
    client = new NetClient({ url: `ws://127.0.0.1:${port}`, room: 'QWER', create: true });
    client.connect();
    await waitFor(() => client.slot >= 0);
    client.send({ t: 'settings', stocks: '5' });
    await waitFor(() => client.roomState?.settings?.stocks === 5);
    client.setReady(true);
    await waitFor(() => client.roomState?.phase === 'playing');
    expect(client.roomState.phase).toBe('playing');
  } finally {
    client?.close();
    server.kill();
    globalThis.WebSocket = oldWebSocket;
  }
}, 15000);
