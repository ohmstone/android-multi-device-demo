use log::info;
use android_activity::{ AndroidApp };

use crate::render_loop::render_loop;
use crate::get_window::get_window;

pub fn app_loop(app: &AndroidApp) {

    info!("App Loop START");

    loop {
        let window = get_window(app);
        let exit_reason = render_loop(app, &window);
        // FIXME in some cases we recover, hence the loop
        match exit_reason {
            1 => { break; } // pause
            2 => { break; } // terminated window
            3 => { break; } // destroy
            _ => { break; } // any thing else
        }
    }

    info!("App Loop FINISHED");
}