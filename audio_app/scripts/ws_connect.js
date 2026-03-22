'use strict';

const net    = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SERVICE_NAME = 'AudioAppWS';

// ── Service discovery ─────────────────────────────────────────────────────────

function discoverService(callback) {
  const proc = spawn('avahi-browse', ['-t', '-p', '-v', '-r', '_http._tcp']);
  const chunks = [];

  proc.stdout.on('readable', () => {
    let chunk;
    while (null !== (chunk = proc.stdout.read())) chunks.push(chunk);
  });

  proc.stdout.on('end', () => {
    const lines = chunks.join('').split('\n');
    for (const line of lines) {
      const data = line.split(';');
      let is_service = false;
      let host = '';
      let port = 0;
      for (const d of data) {
        if (host) {
          try {
            const p = parseInt(d, 10);
            if (!isNaN(p) && p > 1000 && p < 0xffff) port = p;
          } catch { continue; }
        }
        if (is_service) {
          if (d.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)) { host = d; continue; }
        } else {
          if (d === SERVICE_NAME) { is_service = true; continue; }
        }
      }
      if (is_service && host && port) return callback(null, host, port);
    }
    callback(new Error(`Service "${SERVICE_NAME}" not found via avahi-browse`));
  });

  proc.on('error', (err) => callback(new Error(`avahi-browse failed: ${err.message}`)));
}

// ── WebSocket helpers ─────────────────────────────────────────────────────────

function wsKey() { return crypto.randomBytes(16).toString('base64'); }

function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let hdr;
  if (len < 126) {
    hdr = Buffer.from([0x81, 0x80 | len, mask[0], mask[1], mask[2], mask[3]]);
  } else if (len < 65536) {
    hdr = Buffer.alloc(8);
    hdr[0] = 0x81; hdr[1] = 0x80 | 126;
    hdr.writeUInt16BE(len, 2);
    mask.copy(hdr, 4);
  } else {
    hdr = Buffer.alloc(14);
    hdr[0] = 0x81; hdr[1] = 0x80 | 127;
    hdr.writeBigUInt64BE(BigInt(len), 2);
    mask.copy(hdr, 10);
  }
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([hdr, masked]);
}

function encodePongFrame(data) {
  const len = data.length;
  const mask = crypto.randomBytes(4);
  const hdr  = Buffer.from([0x8a, 0x80 | len, mask[0], mask[1], mask[2], mask[3]]);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([hdr, masked]);
}

function makeFrameParser(onText, onPing) {
  let buf = Buffer.alloc(0);
  return function feed(chunk) {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) break;
      const opcode  = buf[0] & 0x0f;
      const hasMask = (buf[1] >> 7) & 1;
      let payLen    = buf[1] & 0x7f;
      let offset    = 2;
      if (payLen === 126) {
        if (buf.length < 4) break;
        payLen = buf.readUInt16BE(2); offset = 4;
      } else if (payLen === 127) {
        if (buf.length < 10) break;
        payLen = Number(buf.readBigUInt64BE(2)); offset = 10;
      }
      if (hasMask) offset += 4;
      if (buf.length < offset + payLen) break;

      let payload = buf.slice(offset, offset + payLen);
      if (hasMask) {
        const m = buf.slice(offset - 4, offset);
        const u = Buffer.allocUnsafe(payload.length);
        for (let i = 0; i < payload.length; i++) u[i] = payload[i] ^ m[i % 4];
        payload = u;
      }
      buf = buf.slice(offset + payLen);

      if      (opcode === 1) onText(payload.toString('utf8'));
      else if (opcode === 9) onPing(payload);
    }
  };
}

// ── Display helpers ───────────────────────────────────────────────────────────

function fmtMsg(tag, msg) {
  return msg.split('\n')
    .map((l, i) => (i === 0 ? `${tag}: ${l}` : `    ... ${l}`))
    .join('\n');
}

// ── Terminal UI ───────────────────────────────────────────────────────────────

const PROMPT = '> ';

let draftLines    = [''];
let renderedLines = 1;

function clearInput() {
  if (renderedLines > 1) process.stdout.write(`\x1b[${renderedLines - 1}A`);
  process.stdout.write('\r\x1b[J');
}

function renderInput() {
  process.stdout.write(
    draftLines.map((l, i) => (i === 0 ? PROMPT : '  ') + l).join('\n')
  );
  renderedLines = draftLines.length;
}

function printLine(text) {
  clearInput();
  process.stdout.write(text + '\n');
  renderInput();
}

// ── Key handling ──────────────────────────────────────────────────────────────

let sendFn = null;

function handleKey(raw) {
  const s = raw.toString('utf8');

  if (s === '\x13') {
    if (draftLines.some(l => l.length > 0)) {
      const msg = draftLines.join('\n');
      clearInput();
      draftLines = [''];
      process.stdout.write(fmtMsg('[SENT]', msg) + '\n');
      renderInput();
      if (sendFn) sendFn(msg);
    }
    return;
  }

  if (s.startsWith('\x1b')) return;

  if (s === '\r' || s === '\n') {
    clearInput();
    draftLines.push('');
    renderInput();
    return;
  }

  if (s === '\x7f' || s === '\x08') {
    const last = draftLines[draftLines.length - 1];
    if (last.length > 0) {
      draftLines[draftLines.length - 1] = last.slice(0, -1);
      process.stdout.write('\b \b');
    } else if (draftLines.length > 1) {
      clearInput();
      draftLines.pop();
      renderInput();
    }
    return;
  }

  draftLines[draftLines.length - 1] += s;
  process.stdout.write(s);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanup() {
  process.stdout.write('\n');
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

if (!process.stdin.isTTY) {
  process.stderr.write('Error: stdin must be a TTY\n');
  process.exit(1);
}

process.stdin.setRawMode(true);
process.stdin.resume();

let connected = false;
process.stdin.on('data', (raw) => {
  const s = raw.toString('utf8');
  if (s === '\x03' || s === '\x04') { cleanup(); process.exit(0); }
  if (connected) handleKey(raw);
});

// ── Discover then connect ─────────────────────────────────────────────────────

process.stdout.write(`Discovering "${SERVICE_NAME}" via avahi-browse...\n`);

discoverService((err, IP, PORT) => {
  if (err) {
    cleanup();
    process.stderr.write(`Discovery failed: ${err.message}\n`);
    process.exit(1);
  }

  process.stdout.write(`Found service at ${IP}:${PORT}\n`);
  process.stdout.write(`Connecting to ws://${IP}:${PORT}...\n`);

  const CONNECT_TIMEOUT_MS = 5000;
  const connectTimer = setTimeout(() => {
    cleanup();
    process.stderr.write(`Connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s\n`);
    process.exit(1);
  }, CONNECT_TIMEOUT_MS);

  const key    = wsKey();
  const socket = net.createConnection(PORT, IP, () => {
    clearTimeout(connectTimer);
    socket.write(
      `GET / HTTP/1.1\r\n` +
      `Host: ${IP}:${PORT}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\n` +
      `Sec-WebSocket-Version: 13\r\n` +
      `\r\n`
    );
  });

  sendFn = (msg) => socket.write(encodeTextFrame(msg));

  const feedFrame = makeFrameParser(
    (text) => printLine(fmtMsg('[RECV]', text)),
    (data) => socket.write(encodePongFrame(data))
  );

  let hsBuf  = Buffer.alloc(0);
  let hsDone = false;

  socket.on('data', (chunk) => {
    if (hsDone) { feedFrame(chunk); return; }

    hsBuf = Buffer.concat([hsBuf, chunk]);

    let sepAt = -1;
    for (let i = 0; i <= hsBuf.length - 4; i++) {
      if (hsBuf[i] === 13 && hsBuf[i+1] === 10 && hsBuf[i+2] === 13 && hsBuf[i+3] === 10) {
        sepAt = i; break;
      }
    }
    if (sepAt === -1) return;

    if (!hsBuf.slice(0, sepAt).toString('utf8').includes('101')) {
      cleanup();
      process.stderr.write('WebSocket handshake failed\n');
      process.exit(1);
    }

    hsDone    = true;
    connected = true;
    process.stdout.write(`Connected to ws://${IP}:${PORT}  (Enter = newline, Ctrl+S = send)\n`);
    renderInput();

    const rest = hsBuf.slice(sepAt + 4);
    if (rest.length > 0) feedFrame(rest);
  });

  socket.on('error', (err) => {
    cleanup();
    process.stderr.write(`\nConnection error: ${err.message}\n`);
    process.exit(1);
  });

  socket.on('close', () => {
    cleanup();
    process.stdout.write('\nDisconnected.\n');
    process.exit(0);
  });
});
