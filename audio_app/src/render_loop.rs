use android_activity::{ AndroidApp };
use std::{time::Duration};
use ndk_sys::{timespec, clock_gettime, CLOCK_MONOTONIC};
use log::info;
use ndk::native_window::NativeWindow;
use std::sync::mpsc::{channel};
use std::thread::{self};

use crate::handle_input::handle_input;
use crate::nsd::{NsdCommand, run_nsd};
use crate::ws_server::{InWsServerCmd, OutWsServerCmd, ws_server};

pub fn render_loop(app: &AndroidApp, window: &NativeWindow) -> i32 {
    let mut ts = timespec { tv_sec: 0, tv_nsec: 0 };
    let width  = window.width();
    let height = window.height();
    let (w, h)   = (width as f32, height as f32);

    // FIXME: these strings should originate from a config
    let service_name = "AudioAppWS";
    let pkg_name = "one.ohmst.demo1.audioapp";
    let (nsd_handle, tx_nsd) = run_nsd(app, pkg_name.to_string());

    let (tx_out_ws, rx_out_ws) = channel::<OutWsServerCmd>();
    let (tx_in_ws, rx_in_ws) = channel::<InWsServerCmd>();
    let ws_handle = thread::spawn(move || {
        ws_server(0, tx_out_ws, rx_in_ws);
    });
    
    // Setup up render ctx, etc here

    info!("Render loop START");

    loop {
        let (exit, raw_events) = handle_input(app, w, h);
        if let Some(reason) = exit {
            tx_in_ws.send(InWsServerCmd::Close).ok();
            ws_handle.join().ok();
            tx_nsd.send(NsdCommand::Stop).ok();
            nsd_handle.join().ok();
            return reason;
        }

        while let Ok(cmd) = rx_out_ws.try_recv() {
            match cmd {
                OutWsServerCmd::Binary(data) => {
                    info!("Received unhandled binary via ws, has {} bytes.", data.len());
                }
                OutWsServerCmd::Message(msg) => {
                    info!("Received msg via ws:\n{}", msg);
                    if msg.contains("exit") {
                        // Demo ability to affect app via ws
                        tx_in_ws.send(InWsServerCmd::Close).ok();
                        ws_handle.join().ok();
                        tx_nsd.send(NsdCommand::Stop).ok();
                        nsd_handle.join().ok();
                        return 100;
                    }
                    if msg.starts_with("echo") {
                        tx_in_ws.send(InWsServerCmd::Message(msg.to_string())).ok();
                    }
                }
                OutWsServerCmd::Ready(port) => {
                    info!("ws announced ready on port: {}", port);
                    tx_nsd.send(NsdCommand::Start(port, service_name.to_string())).ok();
                }
            }
        }

        unsafe { clock_gettime(CLOCK_MONOTONIC as i32, &mut ts) };
        let _elapsed = (ts.tv_sec as f64 + ts.tv_nsec as f64 * 1e-9) as f32;
        
        // render code happens here
    }
}