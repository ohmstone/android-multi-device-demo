use jni::objects::{GlobalRef, JObject};
use jni::JNIEnv;
use std::sync::OnceLock;

pub static APP_CONTEXT: OnceLock<GlobalRef> = OnceLock::new();

#[unsafe(no_mangle)]
pub extern "system" fn Java_one_ohmst_demo1_audioapp_MainActivity_nativeInit(
    env: JNIEnv,
    _class: JObject,
    context: JObject,
) {
    let global = env.new_global_ref(context).unwrap();
    APP_CONTEXT.set(global).unwrap();
}