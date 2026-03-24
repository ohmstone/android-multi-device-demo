#version 300 es
precision highp float;

uniform float u_freq;
uniform float u_time;
uniform vec2 u_resolution;

out vec4 fragColor;

const float PI = 3.14159265359;

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    float x = uv.x;
    float y = uv.y - 0.5; // center Y in [-0.5, 0.5]

    // Map frequency to a visual cycle count (not literal Hz - just relative density)
    float cycles = clamp(u_freq / 55.0, 0.4, 25.0);

    // Wave scrolls slowly left across the screen
    float wave = sin(x * cycles * 2.0 * PI - u_time * 1.4) * 0.33;

    float dist = abs(y - wave);

    // --- Background: dark blue-black with vignette ---
    vec2 ctr = uv - 0.5;
    float vignette = 1.0 - dot(ctr, ctr) * 1.3;
    vec3 bg = vec3(0.01, 0.025, 0.045) * vignette;

    // Faint center guide line (like oscilloscope graticule)
    float guide = 0.00025 / (abs(y) + 0.003) * 0.18;
    bg += vec3(0.15, 0.35, 0.55) * guide;

    // --- Phosphor glow: three layers ---
    float wide  = exp(-dist * 20.0) * 0.55;   // broad diffuse halo
    float soft  = exp(-dist * 70.0) * 0.85;   // inner glow
    float core  = exp(-dist * 350.0);          // bright sharp line

    vec3 halo_col = vec3(0.0,  0.45, 0.28);
    vec3 glow_col = vec3(0.05, 0.85, 0.50);
    vec3 core_col = vec3(0.75, 1.0,  0.88);

    vec3 col = bg + halo_col * wide + glow_col * soft + core_col * core;

    // Subtle scanlines (every other pixel row, like a real CRT)
    float scan = 1.0 - sin(gl_FragCoord.y * PI) * sin(gl_FragCoord.y * PI) * 0.07;
    col *= scan;

    // Mild tone-map to keep highlights from blowing out
    col = col / (col + vec3(0.28)) * 1.35;

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
