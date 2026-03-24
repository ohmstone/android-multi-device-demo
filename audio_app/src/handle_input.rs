use std::time::Duration;

use android_activity::{
    AndroidApp, InputStatus, MainEvent, PollEvent,
    input::{InputEvent, Keycode, MotionAction, MotionEvent},
};

pub struct RawTouchEvent {
    pub _pointer_id: i32,
    pub _action:     TouchAction,
    pub _nx: f32,
    pub _ny: f32,
}

pub enum TouchAction { Down, Move, Up }

pub fn handle_input(
    app:    &AndroidApp,
    width:  f32,
    height: f32,
) -> (Option<i32>, Vec<RawTouchEvent>) {
    let mut exit_reason: Option<i32> = None;
    let mut events: Vec<RawTouchEvent> = Vec::new();

    let mut push_touch = |motion: &MotionEvent<'_>, action: TouchAction| {
        let p = motion.pointer_at_index(motion.pointer_index());
        events.push(RawTouchEvent {
            _pointer_id: p.pointer_id(),
            _action: action,
            _nx: p.x() / width,
            _ny: p.y() / height,
        });
    };

    app.poll_events(Some(Duration::ZERO), |event| {
        match event {
            PollEvent::Main(main_event) => {
                match main_event {
                    MainEvent::Pause => {
                        exit_reason = Some(1);
                    }
                    MainEvent::TerminateWindow { .. } => {
                        exit_reason = Some(2);
                    }
                    MainEvent::Destroy => {
                        exit_reason = Some(3);
                    }
                    MainEvent::InputAvailable { .. } => {
                        match app.input_events_iter() {
                            Ok(mut iter) => loop {
                                if !iter.next(|ev| {
                                    if let InputEvent::MotionEvent(me) = ev {
                                        match me.action() {
                                            MotionAction::Down | MotionAction::PointerDown => {
                                                push_touch(me, TouchAction::Down);
                                            }
                                            MotionAction::Move => {
                                                push_touch(me, TouchAction::Move);
                                            }
                                            MotionAction::Up | MotionAction::PointerUp => {
                                                push_touch(me, TouchAction::Up);
                                            }
                                            _ => {}
                                        }
                                        InputStatus::Handled
                                    } else if let InputEvent::KeyEvent(ke) = ev {
                                        match ke.key_code() {
                                            Keycode::VolumeUp | Keycode::VolumeDown => InputStatus::Unhandled,
                                            _ => InputStatus::Handled
                                        }
                                    } else {
                                        InputStatus::Handled
                                    }
                                }) {
                                    break;
                                }
                            },
                            Err(e) => log::error!("Input Error: {e:?}"),
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    });

    (exit_reason, events)
}
