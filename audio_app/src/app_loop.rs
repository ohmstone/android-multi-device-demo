use log::info;
use android_activity::{ AndroidApp };

use crate::render_loop::render_loop;
use crate::get_window::get_window;

pub fn app_loop(app: &AndroidApp) {

    let mut quit = false;

    info!("App Loop START");

    while !quit {
        let window = get_window(app);
        let exit_reason = render_loop(app, &window);
        match exit_reason {
            1 => { quit = true; } // pause
            2 => { quit = true; } // terminated window
            3 => { quit = true; } // destroy
            _ => { quit = true; } // any thing else
        }
    }

    info!("App Loop FINISHED");
}