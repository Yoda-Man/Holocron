/**
 * node.vert — Vertex shader for Holocron VR node spheres
 *
 * Renders an instanced sphere with per-instance colour, size, and
 * glow intensity. Used by the InstancedMesh in VRViewer.
 *
 * Uniforms provided by Three.js + plugin config:
 *   - uGlowIntensity: global glow multiplier (from LOD tier)
 *   - uTime:          elapsed time for subtle idle animation
 */
varying vec3 vPosition;
varying vec3 vNormal;
varying float vGlow;

uniform float uGlowIntensity;
uniform float uTime;

attribute vec3 instanceColor;
attribute float instanceSize;
attribute float instanceGlow;

void main() {
    vNormal   = normalize(normalMatrix * normal);
    vGlow     = instanceGlow * uGlowIntensity;
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;

    vec3 pos = position * instanceSize;
    // Subtle idle pulse (amplitude 0.02 units, frequency 0.5 Hz)
    pos += normal * sin(uTime * 3.14159 + instanceGlow * 6.2832) * 0.02;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
}
