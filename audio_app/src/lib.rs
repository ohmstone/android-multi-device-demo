use android_activity::{ AndroidApp };
mod render_loop;
mod app_loop;
mod get_window;
mod handle_input;
mod ws_server;
use crate::app_loop::app_loop;


#[unsafe(no_mangle)]
fn android_main(app: AndroidApp) {
    android_logger::init_once(android_logger::Config::default().with_min_level(log::Level::Info));

    log::info!("App is OPEN");
    app_loop(&app);
    log::info!("App will CLOSE");
}
