use std::time::Duration;

use android_activity::{ AndroidApp, MainEvent, PollEvent };
use ndk::native_window::NativeWindow;

pub fn get_window(app: &AndroidApp) -> NativeWindow {
  let native_window: NativeWindow = {
      let mut window: Option<NativeWindow> = None;
      let mut wait = true;
      while wait {
          // FIXME also watch for other events
          app.poll_events(
          Some(Duration::from_millis(100)), /* timeout */
          |event| {
              match event {
                  PollEvent::Main(main_event) => {
                      match main_event {
                          MainEvent::InitWindow { .. } => {
                              window = app.native_window();
                              wait = false;
                          }
                          _ => {}
                      }
                  }
                  _ => {}
              }
          })
      }
      if window == None {
          panic!("Ah! No window!");
      }
      window.unwrap()
  };

  native_window
}