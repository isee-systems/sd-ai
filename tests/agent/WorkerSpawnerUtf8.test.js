import net from 'net';
import os from 'os';
import path from 'path';
import { IpcWorker } from '../../agent/WorkerSpawner.js';

// Worker → main IPC is newline-delimited JSON over a unix socket. A multi-byte
// UTF-8 character can straddle two socket chunks; decoding each chunk on its
// own turned it into U+FFFD and corrupted non-ASCII variable names on their
// way to the client (seen in production with Latvian model names).
describe('IpcWorker UTF-8 framing', () => {
  it('reassembles a multi-byte character split across socket chunks', async () => {
    const socketPath = path.join(os.tmpdir(), `ipc-utf8-${process.pid}-${Date.now()}.sock`);
    const worker = await IpcWorker.listen(socketPath);
    // A corrupted line fails JSON.parse and is dropped, so bound the wait
    // rather than hang until jest's timeout with the socket still open.
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no message received')), 2000);
      worker.once('message', (msg) => { clearTimeout(timer); resolve(msg); });
    });

    const bytes = Buffer.from(JSON.stringify({ name: 'ATKRITUMU TRANSPORTĒŠANA' }) + '\n', 'utf8');
    const splitAt = bytes.indexOf(Buffer.from('Ē', 'utf8')) + 1; // inside the 2-byte sequence

    const client = net.createConnection(socketPath);
    await new Promise((resolve) => client.once('connect', resolve));
    client.write(bytes.subarray(0, splitAt));
    await new Promise((resolve) => setTimeout(resolve, 20));
    client.write(bytes.subarray(splitAt));

    try {
      expect(await received).toEqual({ name: 'ATKRITUMU TRANSPORTĒŠANA' });
    } finally {
      client.destroy();
      worker.dispose();
    }
  });
});
