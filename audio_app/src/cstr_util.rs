use std::ffi::CString;

pub fn create_whitespace_cstring_with_len(len: usize) -> CString {
    // allocate buffer of correct size
    let mut buffer: Vec<u8> = Vec::with_capacity(len + 1);
    // fill it with len spaces
    buffer.extend([b' '].iter().cycle().take(len));
    // convert buffer to CString
    unsafe { CString::from_vec_unchecked(buffer) }
}

#[macro_export]
macro_rules! cstr {
    ($s:literal) => {
        std::ffi::CStr::from_bytes_with_nul(concat!($s, "\0").as_bytes())
            .unwrap()
            .as_ptr()
    };
}