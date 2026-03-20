use android_activity::{ AndroidApp };
use std::{time::Duration};
use ndk_sys::{timespec, clock_gettime, CLOCK_MONOTONIC};
use log::info;
use ndk::native_window::NativeWindow;

pub fn render_loop(app: &AndroidApp, window: &NativeWindow) -> i32 {
    let mut quit = false;
    let mut ts = timespec { tv_sec: 0, tv_nsec: 0 };
    let mut exit_reason = -1;

    // Setup up render ctx, etc here

    info!("Render loop START");

    while !quit {
        // input handling happens here

        if quit {
            break;
        }

        unsafe { clock_gettime(CLOCK_MONOTONIC as i32, &mut ts) };
        let _elapsed = (ts.tv_sec as f64 + ts.tv_nsec as f64 * 1e-9) as f32;

        
        // render code happens here
    }

    info!("Render loop FINISHED");

    exit_reason
}