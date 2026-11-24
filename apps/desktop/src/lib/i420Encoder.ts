/**
 * Virtual-camera frame encoder that runs inside the avatar renderer's own WebGL2 context: no CPU copies and
 * no cross-context canvas transfers, which on integrated GPUs cost more than everything else combined.
 *
 *   1. resolve the rendered (multisampled) canvas into a texture        (blitFramebuffer, GPU only)
 *   2. one pass composes the 16:9 output (crop or fit, mirror, "AI-generated" label) and packs it as I420
 *      (BT.601 limited range, same matrix as the engine); each RGBA8 texel holds 4 consecutive I420 bytes,
 *      so the target is (width / 4) x (height * 1.5) texels
 *   3. readPixels into one of two pixel-pack buffers, guarded by a fence; the bytes of an earlier frame are
 *      returned once the GPU has finished, so the renderer never waits
 */
import type { Rect } from '@/lib/outputCompositor';

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_src;     // resolved frame; texture row 0 = bottom of the picture
uniform sampler2D u_label;   // disclosure label (straight alpha), row 0 = top
uniform vec2 u_size;         // output width, height (pixels)
uniform vec4 u_dest;         // where the picture goes in the output (normalised, top-down)
uniform vec4 u_crop;         // which part of the picture is shown (normalised, top-down)
uniform vec4 u_labelRect;    // label rectangle in the output (normalised, top-down)
uniform float u_mirror;
out vec4 color;

vec3 composite(vec2 o) {     // o: output pixel centre, normalised, top-down
  vec3 c = vec3(9.0, 12.0, 19.0) / 255.0;
  vec2 s = (o - u_dest.xy) / u_dest.zw;
  if (all(greaterThanEqual(s, vec2(0.0))) && all(lessThanEqual(s, vec2(1.0)))) {
    if (u_mirror > 0.5) s.x = 1.0 - s.x;
    vec2 p = u_crop.xy + s * u_crop.zw;
    c = texture(u_src, vec2(p.x, 1.0 - p.y)).rgb;
  }
  vec2 l = (o - u_labelRect.xy) / u_labelRect.zw;
  if (all(greaterThanEqual(l, vec2(0.0))) && all(lessThanEqual(l, vec2(1.0)))) {
    vec4 t = texture(u_label, l);
    c = mix(c, t.rgb, t.a);
  }
  return c;
}

vec3 at(float x, float y) { return composite(vec2((x + 0.5) / u_size.x, (y + 0.5) / u_size.y)); }

void main() {
  float w = u_size.x, h = u_size.y;
  float row = floor(gl_FragCoord.y);     // readPixels row 0 = first row of the I420 buffer
  float byte0 = floor(gl_FragCoord.x) * 4.0;
  vec4 v;
  if (row < h) {
    for (int k = 0; k < 4; k++) v[k] = 16.0 / 255.0 + dot(at(byte0 + float(k), row), vec3(0.257, 0.504, 0.098));
  } else {
    bool isU = row < h * 1.25;
    float planeRow = row - (isU ? h : h * 1.25);
    for (int k = 0; k < 4; k++) {
      float i = planeRow * w + byte0 + float(k);
      float cx = mod(i, w * 0.5), cy = floor(i / (w * 0.5));
      vec3 c = 0.25 * (at(2.0 * cx, 2.0 * cy) + at(2.0 * cx + 1.0, 2.0 * cy) + at(2.0 * cx, 2.0 * cy + 1.0) + at(2.0 * cx + 1.0, 2.0 * cy + 1.0));
      v[k] = 128.0 / 255.0 + (isU ? dot(c, vec3(-0.148, -0.291, 0.439)) : dot(c, vec3(0.439, -0.368, -0.071)));
    }
  }
  color = clamp(v, 0.0, 1.0);
}`;

export interface EncodeOptions {
  width: number;
  height: number;
  mirrored: boolean;
  /** Normalised (0..1, top-down) rectangles: where the picture goes, and which part of it is shown. */
  dest: Rect;
  crop: Rect;
}

interface Slot { buffer: WebGLBuffer; fence: WebGLSync | null }

export class I420Encoder {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quad: WebGLBuffer;
  private readonly frame: WebGLTexture;
  private readonly frameFbo: WebGLFramebuffer;
  private readonly packed: WebGLTexture;
  private readonly packedFbo: WebGLFramebuffer;
  private readonly label: WebGLTexture;
  private labelRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private slots: Slot[] = [];
  private next = 0;
  private frameSize = { width: 0, height: 0 };
  private outSize = { width: 0, height: 0 };

  constructor(private readonly gl: WebGL2RenderingContext) {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'I420 shader failed to compile.');
      return s;
    };
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.bindAttribLocation(this.program, 0, 'a_pos');
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? 'I420 program failed to link.');
    this.vao = gl.createVertexArray()!;
    this.quad = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.frame = this.texture();
    this.packed = this.texture();
    this.label = this.texture();
    this.frameFbo = gl.createFramebuffer()!;
    this.packedFbo = gl.createFramebuffer()!;
  }

  private texture() {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private resize(frameWidth: number, frameHeight: number, width: number, height: number) {
    const gl = this.gl;
    if (this.frameSize.width !== frameWidth || this.frameSize.height !== frameHeight) {
      gl.bindTexture(gl.TEXTURE_2D, this.frame);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, frameWidth, frameHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.frame, 0);
      this.frameSize = { width: frameWidth, height: frameHeight };
    }
    if (this.outSize.width !== width || this.outSize.height !== height) {
      if (width % 8 || height % 4) throw new Error('The virtual camera size must be divisible by 8 x 4.');
      gl.bindTexture(gl.TEXTURE_2D, this.packed);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width / 4, (height * 3) / 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.packedFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.packed, 0);
      for (const slot of this.slots) { if (slot.fence) gl.deleteSync(slot.fence); gl.deleteBuffer(slot.buffer); }
      const bytes = (width * height * 3) / 2;
      this.slots = [0, 1].map(() => {
        const buffer = gl.createBuffer()!;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
        return { buffer, fence: null };
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.drawLabel(width, height);
      this.outSize = { width, height };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Small disclosure so viewers know the video is AI-generated (same look as the recording's label). */
  private drawLabel(width: number, height: number) {
    const gl = this.gl;
    const scale = height / 720;
    const text = 'AI-generated';
    const boxHeight = Math.round(24 * scale);
    const canvas = new OffscreenCanvas(Math.round(160 * scale), boxHeight);
    const ctx = canvas.getContext('2d')!;
    ctx.font = `600 ${Math.round(15 * scale)}px "Segoe UI", system-ui, sans-serif`;
    const padX = 9 * scale;
    const boxWidth = Math.min(canvas.width, ctx.measureText(text).width + padX * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.roundRect(0, 0, boxWidth, boxHeight, boxHeight / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, padX, boxHeight / 2 + 0.5);
    gl.bindTexture(gl.TEXTURE_2D, this.label);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    const margin = 14 * scale;
    this.labelRect = { x: margin / width, y: (height - boxHeight - margin) / height, width: canvas.width / width, height: boxHeight / height };
  }

  /**
   * Encode the frame currently in the default framebuffer (call right after rendering). Returns the I420 bytes
   * of an earlier frame when one is ready, else null. Never waits for the GPU.
   */
  encode(frameWidth: number, frameHeight: number, options: EncodeOptions): Uint8Array | null {
    const gl = this.gl;
    this.resize(frameWidth, frameHeight, options.width, options.height);
    const slot = this.slots[this.next];
    let ready: Uint8Array | null = null;
    if (slot.fence) {
      if (gl.clientWaitSync(slot.fence, 0, 0) === gl.TIMEOUT_EXPIRED) return null; // GPU busy: drop, don't stall
      gl.deleteSync(slot.fence);
      slot.fence = null;
      ready = new Uint8Array((options.width * options.height * 3) / 2);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, ready);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
    // 1. resolve the multisampled canvas into a texture
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.frameFbo);
    gl.blitFramebuffer(0, 0, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    // 2. compose + pack
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.packedFbo);
    gl.viewport(0, 0, options.width / 4, (options.height * 3) / 2);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    const u = (name: string) => gl.getUniformLocation(this.program, name);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frame);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.label);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u('u_src'), 0);
    gl.uniform1i(u('u_label'), 1);
    gl.uniform2f(u('u_size'), options.width, options.height);
    gl.uniform4f(u('u_dest'), options.dest.x, options.dest.y, options.dest.width, options.dest.height);
    gl.uniform4f(u('u_crop'), options.crop.x, options.crop.y, options.crop.width, options.crop.height);
    gl.uniform4f(u('u_labelRect'), this.labelRect.x, this.labelRect.y, this.labelRect.width, this.labelRect.height);
    gl.uniform1f(u('u_mirror'), options.mirrored ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    // 3. async readback
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
    gl.readPixels(0, 0, options.width / 4, (options.height * 3) / 2, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    slot.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.flush();
    this.next = (this.next + 1) % this.slots.length;
    return ready;
  }

  dispose() {
    const gl = this.gl;
    for (const slot of this.slots) { if (slot.fence) gl.deleteSync(slot.fence); gl.deleteBuffer(slot.buffer); }
    gl.deleteFramebuffer(this.frameFbo);
    gl.deleteFramebuffer(this.packedFbo);
    for (const t of [this.frame, this.packed, this.label]) gl.deleteTexture(t);
    gl.deleteBuffer(this.quad);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
