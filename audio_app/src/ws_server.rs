use std::{
    io::{self, Read, Write},
    net::{TcpListener, TcpStream},
    sync::mpsc::{Receiver, Sender},
    thread::sleep,
    time::Duration,
};
use log::*;

pub enum OutWsServerCmd {
    Ready(u16),
    Message(String),
    Binary(Vec<u8>),
}

pub enum InWsServerCmd {
    Close,
    Message(String),
}

/// Run the WebSocket server. Call this in a dedicated thread.
/// - `port`: port to bind on, or `0` to let the OS assign one
/// - `tx`: send events to the application
/// - `rx`: receive messages from the application to broadcast to all clients
pub fn ws_server(port: u16, tx: Sender<OutWsServerCmd>, rx: Receiver<InWsServerCmd>) {
    let listener = TcpListener::bind(("0.0.0.0", port)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let bound_port = listener.local_addr().unwrap().port();
    info!("WebSocket server listening on port {}", bound_port);
    tx.send(OutWsServerCmd::Ready(bound_port)).ok();

    let mut clients: Vec<TcpStream> = Vec::new();
    let mut buf = [0u8; 4096];

    loop {
        // Accept new WebSocket connections
        match listener.accept() {
            Ok((mut stream, addr)) => {
                if handshake(&mut stream) {
                    stream.set_nonblocking(true).unwrap();
                    clients.push(stream);
                    info!("Client connected from {} (total: {})", addr, clients.len());
                }
            }
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {}
            Err(e) => error!("Accept error: {e}"),
        }

        // Broadcast outgoing messages to all clients
        while let Ok(cmd) = rx.try_recv() {
            match cmd {
                InWsServerCmd::Close => {
                    info!("WebSocket server closing.");
                    let close_frame = encode_frame(0x88, &[]); // opcode 0x88 = connection close
                    for client in &mut clients {
                        client.write_all(&close_frame).ok();
                    }
                    return;
                }
                InWsServerCmd::Message(msg) => {
                    let frame = encode_text(&msg);
                    clients.retain_mut(|c| c.write_all(&frame).is_ok());
                }
            }
        }

        // Read incoming frames from all clients
        let mut dead = vec![];
        for (i, client) in clients.iter_mut().enumerate() {
            match read_frame(client, &mut buf) {
                Ok(Some(Frame::Text(msg))) => on_message(&msg, &tx),
                Ok(Some(Frame::Binary(data))) => { tx.send(OutWsServerCmd::Binary(data)).ok(); }
                Ok(Some(Frame::Ping(data))) => {
                    client.write_all(&encode_pong(&data)).ok();
                }
                Ok(_) => {}
                Err(_) => dead.push(i),
            }
        }
        for i in dead.into_iter().rev() {
            clients.swap_remove(i);
            info!("Client disconnected (total: {})", clients.len());
        }

        sleep(Duration::from_millis(1));
    }
}

fn on_message(msg: &str, tx: &Sender<OutWsServerCmd>) {
    tx.send(OutWsServerCmd::Message(msg.to_owned())).ok();
}

// --- WebSocket frame types ---

enum Frame {
    Text(String),
    Ping(Vec<u8>),
    Binary(Vec<u8>),
}

// --- Frame I/O ---

fn read_frame(conn: &mut TcpStream, buf: &mut [u8]) -> io::Result<Option<Frame>> {
    match conn.read(buf) {
        Ok(0) => Err(io::ErrorKind::ConnectionReset.into()),
        Ok(_) => {
            let opcode = buf[0] & 0x0f;
            let has_mask = buf[1] >> 7;
            let mut payload_len = (buf[1] & 0x7f) as usize;
            let mut offset = 2;

            if payload_len == 126 {
                payload_len = u16::from_be_bytes([buf[2], buf[3]]) as usize;
                offset = 4;
            } else if payload_len == 127 {
                payload_len = u64::from_be_bytes(buf[2..10].try_into().unwrap()) as usize;
                offset = 10;
            }

            let mask = if has_mask == 1 {
                let m = [buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]];
                offset += 4;
                Some(m)
            } else {
                None
            };

            let data: Vec<u8> = (0..payload_len)
                .map(|i| {
                    let byte = buf[offset + i];
                    mask.map_or(byte, |m| byte ^ m[i % 4])
                })
                .collect();

            let frame = match opcode {
                1 => Frame::Text(String::from_utf8_lossy(&data).into_owned()),
                2 => Frame::Binary(data),
                9 => Frame::Ping(data),
                _ => return Ok(None),
            };
            Ok(Some(frame))
        }
        Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => Ok(None),
        Err(e) => Err(e),
    }
}

fn encode_text(msg: &str) -> Vec<u8> {
    encode_frame(0x81, msg.as_bytes())
}

fn encode_pong(data: &[u8]) -> Vec<u8> {
    encode_frame(0x8a, data)
}

fn encode_frame(opcode_byte: u8, data: &[u8]) -> Vec<u8> {
    let len = data.len();
    let mut frame = Vec::with_capacity(10 + len);
    frame.push(opcode_byte);
    if len < 126 {
        frame.push(len as u8);
    } else if len < 65536 {
        frame.push(126);
        frame.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        frame.push(127);
        frame.extend_from_slice(&(len as u64).to_be_bytes());
    }
    frame.extend_from_slice(data);
    frame
}

// --- WebSocket handshake ---

fn handshake(stream: &mut TcpStream) -> bool {
    let mut buf = [0u8; 2048];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return false,
    };

    let Some(key) = extract_ws_key(&buf[..n]) else {
        return false;
    };

    let mut sha = sha1_smol::Sha1::new();
    let mut combined = key.to_vec();
    combined.extend_from_slice(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    sha.update(&combined);
    let accept = base64(&sha.digest().bytes());

    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).is_ok() && stream.flush().is_ok()
}

fn extract_ws_key(buf: &[u8]) -> Option<&[u8]> {
    let needle = b"Sec-WebSocket-Key: ";
    let pos = buf.windows(needle.len()).position(|w| w == needle)?;
    let start = pos + needle.len();
    let end = buf[start..].iter().position(|&b| b == b'\r')? + start;
    Some(&buf[start..end])
}

// --- Base64 (for handshake) ---

const BASE64_TABLE: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64(bytes: &[u8]) -> String {
    let mut out = Vec::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        out.push(BASE64_TABLE[(b0 >> 2) as usize]);
        out.push(BASE64_TABLE[(((b0 & 3) << 4) | (b1 >> 4)) as usize]);
        out.push(if chunk.len() > 1 { BASE64_TABLE[(((b1 & 0xf) << 2) | (b2 >> 6)) as usize] } else { b'=' });
        out.push(if chunk.len() > 2 { BASE64_TABLE[(b2 & 0x3f) as usize] } else { b'=' });
    }
    String::from_utf8(out).unwrap()
}
