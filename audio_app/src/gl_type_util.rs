#[macro_export]
macro_rules! offset_of {
    ($count:expr, $type:ty) => {
        ($count * std::mem::size_of::<$type>()) as *const std::ffi::c_void
    };
}