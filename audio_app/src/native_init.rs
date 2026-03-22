use jni::objects::{GlobalRef, JObject};
use jni::JNIEnv;
use std::sync::{Mutex, OnceLock};

pub static APP_CONTEXT: OnceLock<Mutex<Option<GlobalRef>>> = OnceLock::new();

#[unsafe(no_mangle)]
pub extern "system" fn Java_one_ohmst_demo1_audioapp_MainActivity_nativeInit(
    env: JNIEnv,
    _class: JObject,
    context: JObject,
) {
    let global = env.new_global_ref(context).unwrap();
    let mutex = APP_CONTEXT.get_or_init(|| Mutex::new(None));
    *mutex.lock().unwrap() = Some(global);
}