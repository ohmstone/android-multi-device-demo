#!/usr/bin/env node
'use strict';

const net    = require('net');
const crypto = require('crypto');

const [,, IP, PORT_STR] = process.argv;
if (!IP || !PORT_STR) {
  process.stderr.write('Usage: node ws_client.js <IP> <PORT>\n');
  process.exit(1);
}
const PORT = parseInt(PORT_STR, 10);

// ── WebSocket helpers ─────────────────────────────────────────────────────────

function wsKey() { return crypto.randomBytes(16).toString('base64'); }

/** Encode a text frame with masking (client→server requirement). */
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

/** Encode a pong frame with masking. */
function encodePongFrame(data) {
  const len = data.length;
  const mask = crypto.randomBytes(4);
  const hdr  = Buffer.from([0x8a, 0x80 | len, mask[0], mask[1], mask[2], mask[3]]);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([hdr, masked]);
}

/** Returns a stateful feed(chunk) function that calls onText / onPing per frame. */
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
      // opcode 8 = close, 2 = binary — ignored for this client
    }
  };
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** Format a (possibly multi-line) message for printing. */
function fmtMsg(tag, msg) {
  return msg.split('\n')
    .map((l, i) => (i === 0 ? `${tag}: ${l}` : `    ... ${l}`))
    .join('\n');
}

// ── Terminal UI ───────────────────────────────────────────────────────────────

const PROMPT = '> ';

let draftLines    = [''];  // lines composing the current outgoing message
let renderedLines = 1;     // how many terminal rows the input area occupies

/** Erase the rendered input area, leaving the cursor at the beginning of its first row. */
function clearInput() {
  if (renderedLines > 1) process.stdout.write(`\x1b[${renderedLines - 1}A`);
  process.stdout.write('\r\x1b[J');
}

/** (Re-)draw the input area and record how many rows it occupies. */
function renderInput() {
  process.stdout.write(
    draftLines.map((l, i) => (i === 0 ? PROMPT : '  ') + l).join('\n')
  );
  renderedLines = draftLines.length;
}

/** Print a log line above the input area without disturbing what the user is typing. */
function printLine(text) {
  clearInput();
  process.stdout.write(text + '\n');
  renderInput();
}

// ── Key handling ──────────────────────────────────────────────────────────────

let sendFn = null; // wired up once the socket is ready

function handleKey(raw) {
  const s = raw.toString('utf8');

  // Ctrl+S → send the draft
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

  // Ignore other escape sequences (arrows, F-keys, …)
  if (s.startsWith('\x1b')) return;

  // Enter → newline in draft
  if (s === '\r' || s === '\n') {
    clearInput();
    draftLines.push('');
    renderInput();
    return;
  }

  // Backspace
  if (s === '\x7f' || s === '\x08') {
    const last = draftLines[draftLines.length - 1];
    if (last.length > 0) {
      draftLines[draftLines.length - 1] = last.slice(0, -1);
      process.stdout.write('\b \b'); // erase one character in-place
    } else if (draftLines.length > 1) {
      clearInput();
      draftLines.pop();
      renderInput();
    }
    return;
  }

  // Printable character — append and echo directly (avoids full redraw)
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
// No special terminal modes needed — send key is Ctrl+S (\x13), universally reliable

let connected = false;
process.stdin.on('data', (raw) => {
  const s = raw.toString('utf8');
  if (s === '\x03' || s === '\x04') { cleanup(); process.exit(0); }
  if (connected) handleKey(raw);
});

// ── WebSocket connection ──────────────────────────────────────────────────────

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

// Accumulate bytes until the HTTP/101 response header is fully received,
// then hand off remaining bytes to the frame parser.
let hsBuf  = Buffer.alloc(0);
let hsDone = false;

socket.on('data', (chunk) => {
  if (hsDone) { feedFrame(chunk); return; }

  hsBuf = Buffer.concat([hsBuf, chunk]);

  // Look for the blank line ending the HTTP header (\r\n\r\n)
  let sepAt = -1;
  for (let i = 0; i <= hsBuf.length - 4; i++) {
    if (hsBuf[i] === 13 && hsBuf[i+1] === 10 && hsBuf[i+2] === 13 && hsBuf[i+3] === 10) {
      sepAt = i; break;
    }
  }
  if (sepAt === -1) return; // header not complete yet

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
