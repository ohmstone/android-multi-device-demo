use std::ffi::CString;

use crate::{gl_program::Program, gl_shader::Shader};


pub struct UiScene {
    pub width: i32,
    pub height: i32,
    pub program: Program,
    pub vao: u32,
    pub freq_loc: i32,
    pub time_loc: i32,
    pub resolution_loc: i32,
}

impl UiScene {
    pub fn draw(&self, freq: f32, elapsed: f32) {
        unsafe {
            gl::ClearColor(0.01, 0.025, 0.045, 1.0);
            gl::Clear(gl::COLOR_BUFFER_BIT);
            gl::UseProgram(self.program.id());
            gl::BindVertexArray(self.vao);
            gl::Uniform1f(self.freq_loc, freq);
            gl::Uniform1f(self.time_loc, elapsed);
            gl::Uniform2f(self.resolution_loc, self.width as f32, self.height as f32);
            gl::DrawArrays(gl::TRIANGLES, 0, 3);
        }
    }
}


pub fn ui_scene(width: i32, height: i32) -> UiScene {

    let vert_shader = Shader::from_vert_source(
        &CString::new(include_str!("shader.vert")).unwrap()
    ).unwrap();

    let frag_shader = Shader::from_frag_source(
        &CString::new(include_str!("shader.frag")).unwrap()
    ).unwrap();

    let program = Program::from_shaders(
        &[vert_shader, frag_shader]
    ).unwrap();

    program.set_used();

    unsafe {
        let mut vao = 0u32;
        gl::GenVertexArrays(1, &mut vao);
        gl::BindVertexArray(vao);

        let freq_loc = gl::GetUniformLocation(
            program.id(), CString::new("u_freq").unwrap().as_ptr());
        let time_loc = gl::GetUniformLocation(
            program.id(), CString::new("u_time").unwrap().as_ptr());
        let resolution_loc = gl::GetUniformLocation(
            program.id(), CString::new("u_resolution").unwrap().as_ptr());

        UiScene { width, height, program, vao, freq_loc, time_loc, resolution_loc }
    }
}
