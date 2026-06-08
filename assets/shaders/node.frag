/**
 * node.frag — Fragment shader for Holocron VR node spheres
 *
 * Renders each instance with its per-instance colour, a glow rim
 * based on the Fresnel effect, and optional highlight when selected.
 *
 * Uniforms:
 *   - uSelectedId: instance id of currently selected node (-1 = none)
 *   - uOpacity:    global scene opacity (for fade-in transitions)
 */
varying vec3 vPosition;
varying vec3 vNormal;
varying float vGlow;

uniform vec3 uSelectedId;
uniform float uOpacity;

void main() {
    vec3 baseColor = vNormal * 0.5 + 0.5; // Placeholder: replaced by instanceColor in final impl

    // Rim glow (Fresnel approximation)
    vec3 viewDir = normalize(-vPosition);
    float rim = 1.0 - max(dot(viewDir, vNormal), 0.0);
    rim = pow(rim, 2.0) * vGlow;

    vec3 finalColor = baseColor + vec3(0.3, 0.1, 0.6) * rim;
    gl_FragColor = vec4(finalColor, uOpacity * (0.8 + rim * 0.2));
}
