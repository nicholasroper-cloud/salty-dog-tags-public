// Shared test helpers: free ports, a mock LightBurn UDP endpoint.
import dgram from 'node:dgram';

export async function freeUdpPort() {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.once('error', reject);
    s.bind(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Replies to the reply port like LightBurn does. `handler(cmd)` returns the reply string or null for silence.
export async function mockLightBurn(handler = (cmd) => (cmd === 'PING' || cmd === 'STATUS' ? 'OK' : cmd.startsWith('LOADFILE:') || cmd.startsWith('FORCELOAD:') ? 'OK' : '?')) {
  const cmdPort = await freeUdpPort();
  const replyPort = await freeUdpPort();
  const received = [];
  const s = dgram.createSocket('udp4');
  s.on('message', (m) => {
    const cmd = m.toString('utf8');
    received.push(cmd);
    const r = typeof handler === 'function' ? handler(cmd) : handler;
    if (r != null) s.send(Buffer.from(r + '\0'), replyPort, '127.0.0.1');
  });
  await new Promise((r) => s.bind(cmdPort, '127.0.0.1', r));
  return { cmdPort, replyPort, received, close: () => new Promise((r) => s.close(r)) };
}

export function lbConfig(mock, over = {}) {
  return { lightburn: { host: '127.0.0.1', cmdPort: mock.cmdPort, replyPort: mock.replyPort, timeoutMs: 150, minLoadGapMs: 5000, pingEverySeconds: 30, postLoadCheckMs: 5, ...over } };
}
