use android_activity::{ AndroidApp };
use std::{time::Duration};
use ndk_sys::{timespec, clock_gettime, CLOCK_MONOTONIC};
use log::info;
use ndk::native_window::NativeWindow;

use crate::handle_input::handle_input;

pub fn render_loop(app: &AndroidApp, window: &NativeWindow) -> i32 {
    let mut ts = timespec { tv_sec: 0, tv_nsec: 0 };
    let width  = window.width();
    let height = window.height();
    let (w, h)   = (width as f32, height as f32);
    
    // Setup up render ctx, etc here

    info!("Render loop START");

    loop {
        let (exit, raw_events) = handle_input(app, w, h);
        if let Some(reason) = exit {
            return reason;
        }

        unsafe { clock_gettime(CLOCK_MONOTONIC as i32, &mut ts) };
        let _elapsed = (ts.tv_sec as f64 + ts.tv_nsec as f64 * 1e-9) as f32;

        
        // render code happens here
    }
}