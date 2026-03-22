use std::{sync::{Arc, mpsc::Receiver}, thread::sleep, time::Duration};

use android_activity::AndroidApp;
use jni::{JNIEnv, JavaVM, objects::{JClass, JObject, JValue}, sys::{JNIInvokeInterface_}};
use std::sync::mpsc::{Sender, channel};
use std::thread::{self, JoinHandle};

use crate::native_init::APP_CONTEXT;

pub enum NsdCommand {
  Start(u16, String),
  Stop,
}

pub fn run_nsd(app: &AndroidApp, pkg_name: String) -> (JoinHandle<()>, Sender<NsdCommand>) {
    let (tx_nsd, rx_nsd) = channel::<NsdCommand>();
    
    let _vm_ptr = unsafe {app.vm_as_ptr().as_ref()};
    let vm = unsafe { JavaVM::from_raw(app.vm_as_ptr() as *mut *const JNIInvokeInterface_) }.unwrap();
    let vm = Arc::new(vm);
    let vm_clone = vm.clone();
    let nsd_handle = thread::spawn({
        move || {
            let mut env = vm_clone.attach_current_thread_permanently().unwrap();
            nsd(pkg_name, &mut env, rx_nsd);
        }
    });

    (nsd_handle, tx_nsd)
}

// NSD = Network Service Discovery
fn nsd(pkg_name: String, env: &mut JNIEnv<'_>, rx: Receiver<NsdCommand>) {
    let class_name_path = format!("{}.NsdHelper", pkg_name.as_str());
    let ctor_sig = "(Landroid/content/Context;)V";

    // generic per class
    
    let context = APP_CONTEXT.get().unwrap().as_obj();
    let ctx_obj = JValue::Object(context);

    let class_loader = env
        .call_method(
            context,
            "getClassLoader",
            "()Ljava/lang/ClassLoader;",
            &[],
        )
        .unwrap()
        .l()
        .unwrap();
    let class_name = env
        .new_string(class_name_path)
        .unwrap();
    let class_obj = env
        .call_method(
            class_loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&class_name.into())],
        )
        .unwrap()
        .l()
        .unwrap();
    let class_ref = JClass::from(class_obj);

    // varies per class
    let instance = env
        .new_object(class_ref, ctor_sig, &[ctx_obj])
        .unwrap();
    let instance_ref = instance.as_ref();

    let mut start = |port: u16, service_name: String, env: &mut JNIEnv<'_>, instance: &JObject<'_>| {
      let method_arg_service_name = service_name.as_str();
      let method_arg_port = port as i32;
      let method_name = "start";
      let method_sig = "(ILjava/lang/String;)V";
      let arg_val = env.new_string(method_arg_service_name).unwrap();
      env.call_method(
          instance,
          method_name,
          method_sig,
          &[
            JValue::Int(method_arg_port),
            JValue::Object(&arg_val.into()),
          ],
      )
      .unwrap();
    };


    let stop = |env: &mut JNIEnv<'_>, instance: &JObject<'_>| {
      let method_name = "stop";
      let method_sig = "()V";
      env.call_method(
          instance,
          method_name,
          method_sig,
          &[],
      )
      .unwrap();
    };

    
    // keep thread and service alive
    loop {
      if let Ok(cmd) = rx.try_recv() {
          match cmd {
              NsdCommand::Start(port, service_name) => {
                start(port, service_name, env, instance_ref);
              }
              NsdCommand::Stop => {
                // close thread
                stop(env, instance_ref);
                break;
              }
          }
      }
      sleep(Duration::from_millis(100));
    }
}