#version 300 es
void main() {
    // Fullscreen triangle - no vertex buffer needed
    float x = float(gl_VertexID & 1) * 4.0 - 1.0;
    float y = float(gl_VertexID >> 1) * 4.0 - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
