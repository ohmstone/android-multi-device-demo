use egl::*;
use ndk::native_window::NativeWindow;
use std::marker::PhantomData;
use std::rc::Rc;
use std::ffi::{c_void};

pub struct GlContext {
    pub display: EGLDisplay,
    pub surface: EGLSurface,
    pub context: EGLContext,
    _not_send: PhantomData<Rc<()>>,
}

impl Drop for GlContext {
    fn drop(&mut self) {
        make_current(self.display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        destroy_surface(self.display, self.surface);
        destroy_context(self.display, self.context);
        terminate(self.display);
    }
}

impl GlContext {
    pub fn make_current(&self) {
        make_current(self.display, self.surface, self.surface, self.context);
    }
}

pub fn gl_ctx(window: &NativeWindow) -> GlContext {
    let display = get_display(EGL_DEFAULT_DISPLAY as *mut _).unwrap();
    assert!(display != EGL_NO_DISPLAY);

    let mut major = 0;
    let mut minor = 0;
    initialize(display, &mut major, &mut minor);

    let attribs = [
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
        EGL_RED_SIZE, 8,
        EGL_GREEN_SIZE, 8,
        EGL_BLUE_SIZE, 8,
        EGL_DEPTH_SIZE, 24,
        EGL_NONE,
    ];

    let configs = choose_config(display, &attribs, 1).unwrap();
    let config = configs.wrapping_add(0);

    let ctx_attribs = [EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE];
    let context = create_context(display, config, EGL_NO_CONTEXT, &ctx_attribs).unwrap();
    assert!(context != EGL_NO_CONTEXT);

    let surface = create_window_surface(display, config, window.ptr().as_ptr() as *mut _, &[]).unwrap();
    assert!(surface != EGL_NO_SURFACE);

    make_current(display, surface, surface, context);
    swap_interval(display, 1);

    gl::load_with(|name| get_proc_address(name) as *const c_void);
    unsafe {gl::Viewport(0, 0, window.width(), window.height());}

    GlContext { display, surface, context, _not_send: PhantomData }
}