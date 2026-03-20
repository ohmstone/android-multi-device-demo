use android_activity::{ AndroidApp };


#[unsafe(no_mangle)]
fn android_main(app: AndroidApp) {
    android_logger::init_once(android_logger::Config::default().with_min_level(log::Level::Info));

    // this will just run and close
    log::info!("Hello, world!");
}
