import type { Plate } from '@/lib/backgroundPlate';
import { cropCorners, type FaceCrop } from '@/lib/faceCrop';
import { I420Encoder, type EncodeOptions } from '@/lib/i420Encoder';
import type { AvatarRig, MouthFrame } from '@/lib/reenactment';

/**
 * WebGL2 renderer for a deformed portrait mesh. Passes:
 *   0. static background plate (only when a subject matte is set): the original picture, never warped,
 *      with the subject's own area reconstructed from the surrounding background
 *   1. outer mesh (hair, neck, shoulders). With a matte, background pixels in it are transparent, so the
 *      background stays exactly where it is while the subject moves over it
 *   2. eyes   3. procedural mouth interior   4. face tessellation with depth testing
 *
 * The plate and the subject (colours + matte in alpha) are baked once per avatar into textures at output
 * resolution, so every pass costs one texture fetch per pixel. Integrated GPUs are fill-rate bound here.
 */

const VERTEX = `#version 300 es
in vec3 a_pos;
in vec2 a_uv;
uniform vec2 u_size;
uniform vec2 u_zRange;
out vec2 v_uv;
out vec2 v_px;
void main() {
  v_uv = a_uv;
  v_px = a_pos.xy;
  float z = clamp((a_pos.z - u_zRange.x) / (u_zRange.y - u_zRange.x), 0.0, 1.0) * 2.0 - 1.0;
  gl_Position = vec4(a_pos.x / u_size.x * 2.0 - 1.0, 1.0 - a_pos.y / u_size.y * 2.0, z, 1.0);
}`;

// One texture fetch. The subject texture carries the matte in alpha; the plain portrait texture is opaque.
const TEXTURE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_minAlpha;
out vec4 color;
void main() {
  vec4 t = texture(u_tex, v_uv);
  color = vec4(t.rgb, max(u_minAlpha, t.a));
}`;

// Full-screen quad. u_flip = 1 on screen (image y runs down), 0 when baking into a texture.
const QUAD_VERTEX = `#version 300 es
in vec2 a_pos;
uniform float u_flip;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, mix(0.5 + a_pos.y * 0.5, 0.5 - a_pos.y * 0.5, u_flip));
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const COPY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 color;
void main() { color = vec4(texture(u_tex, v_uv).rgb, 1.0); }`;

// Mode 0: background plate (original outside the subject, reconstruction inside). Mode 1: subject + matte.
const BAKE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_matte;
uniform sampler2D u_fill;
uniform sampler2D u_hole;
uniform int u_mode;
out vec4 color;
void main() {
  vec3 original = texture(u_tex, v_uv).rgb;
  float hole = texture(u_hole, v_uv).r;
  if (u_mode == 0) color = vec4(mix(original, texture(u_fill, v_uv).rgb, hole), hole);
  else color = vec4(original, smoothstep(0.3, 0.7, texture(u_matte, v_uv).r));
}`;

// Neural face (LivePortrait output) blended into the untouched portrait: feathered at the crop edge and,
// with a subject matte, limited to the (slightly grown) subject so background pixels stay the original.
const NEURAL_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_px;
uniform sampler2D u_face;
uniform sampler2D u_region;
uniform vec2 u_size;
uniform float u_useRegion;
out vec4 color;
void main() {
  vec2 e = min(v_uv, 1.0 - v_uv);
  float edge = smoothstep(0.0, 0.08, min(e.x, e.y));
  float region = u_useRegion > 0.5 ? smoothstep(0.05, 0.6, texture(u_region, v_px / u_size).a) : 1.0;
  color = vec4(texture(u_face, v_uv).rgb, edge * region);
}`;

const MOUTH_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_px;
uniform sampler2D u_tex;
uniform vec2 u_origin;
uniform vec2 u_axisX;
uniform vec2 u_axisY;
uniform float u_halfWidth;
uniform float u_open;
uniform float u_mix;
out vec4 color;
void main() {
  vec2 d = v_px - u_origin;
  float u = dot(d, u_axisX) / max(u_halfWidth, 1.0);
  float v = dot(d, u_axisY) / max(u_open, 1.0);
  float side = clamp(abs(u), 0.0, 1.0);
  // Dark oral cavity, deepest in the middle of the opening.
  float depth = smoothstep(0.0, 0.45, v) * (1.0 - smoothstep(0.55, 1.0, v));
  vec3 col = mix(vec3(0.22, 0.07, 0.08), vec3(0.035, 0.008, 0.012), clamp(depth * 1.5, 0.0, 1.0) * (1.0 - 0.45 * side));
  // Upper teeth: a band of fixed height relative to the mouth width, hanging from the upper lip.
  float teethV = clamp(0.2 * u_halfWidth / max(u_open, 1.0), 0.0, 0.55);
  float teeth = (1.0 - smoothstep(teethV * 0.72, teethV, v)) * (1.0 - smoothstep(0.5, 0.86, side));
  float gaps = 0.9 + 0.1 * smoothstep(0.0, 0.22, abs(fract(u * 3.4 + 0.5) - 0.5));
  vec3 enamel = vec3(0.93, 0.91, 0.86) * gaps * (0.7 + 0.3 * (1.0 - side)) * (0.85 + 0.15 * smoothstep(0.0, teethV, v));
  col = mix(col, enamel, teeth);
  // Tongue only near the lower lip, and only when the mouth is open enough to see it.
  float openness = u_open / max(u_halfWidth, 1.0);
  float tongue = smoothstep(0.72, 0.95, v) * (1.0 - smoothstep(0.3, 0.75, side)) * smoothstep(0.25, 0.6, openness);
  col = mix(col, vec3(0.45, 0.15, 0.17), tongue * 0.75);
  // Soft shadow under the lips and towards the corners.
  float rim = 1.0 - smoothstep(0.0, 0.14, min(v, 1.0 - v));
  col *= (1.0 - 0.4 * rim) * (0.65 + 0.35 * (1.0 - side * side));
  vec3 tex = texture(u_tex, v_uv).rgb;
  color = vec4(mix(tex, col, u_mix), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed to compile.');
  return shader;
}

function program(gl: WebGL2RenderingContext, fragment: string, vertex = VERTEX) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.bindAttribLocation(p, 1, 'a_uv');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'Shader program failed to link.');
  return p;
}

interface Group {
  buffer: WebGLBuffer;
  count: number;
}

export interface StaticBackground {
  /** Subject coverage 0–255 (person + hair), any resolution. */
  matte: Uint8Array;
  matteWidth: number;
  matteHeight: number;
  plate: Plate;
}

export class AvatarRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly textureProgram: WebGLProgram;
  private readonly mouthProgram: WebGLProgram;
  private readonly copyProgram: WebGLProgram;
  private readonly bakeProgram: WebGLProgram;
  private readonly neuralProgram: WebGLProgram;
  private readonly neuralVao: WebGLVertexArrayObject;
  private readonly neuralBuffer: WebGLBuffer;
  private readonly neuralTexture: WebGLTexture;
  private neuralSeq = -1;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadVao: WebGLVertexArrayObject;
  private readonly positionBuffer: WebGLBuffer;
  private readonly uvBuffer: WebGLBuffer;
  private readonly quadBuffer: WebGLBuffer;
  private readonly texture: WebGLTexture;
  /** Baked per avatar: static background, and subject colours with the matte in alpha. */
  private readonly plateTexture: WebGLTexture;
  private readonly subjectTexture: WebGLTexture;
  private staticBackground = false;
  private encoder: I420Encoder | null = null;
  private groups: Record<'outer' | 'eyes' | 'mouth' | 'face', Group> | null = null;
  private rig: AvatarRig | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available on this graphics adapter.');
    this.gl = gl;
    this.textureProgram = program(gl, TEXTURE_FRAGMENT);
    this.mouthProgram = program(gl, MOUTH_FRAGMENT);
    this.copyProgram = program(gl, COPY_FRAGMENT, QUAD_VERTEX);
    this.bakeProgram = program(gl, BAKE_FRAGMENT, QUAD_VERTEX);
    this.neuralProgram = program(gl, NEURAL_FRAGMENT);
    this.neuralVao = gl.createVertexArray()!;
    this.neuralBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.neuralVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.neuralBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 5 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    this.neuralTexture = gl.createTexture()!;
    this.vao = gl.createVertexArray()!;
    this.positionBuffer = gl.createBuffer()!;
    this.uvBuffer = gl.createBuffer()!;
    this.texture = gl.createTexture()!;
    this.plateTexture = gl.createTexture()!;
    this.subjectTexture = gl.createTexture()!;

    this.quadVao = gl.createVertexArray()!;
    this.quadBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private linearClamp() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private singleChannel(data: Uint8Array, width: number, height: number) {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.linearClamp();
    return texture;
  }

  setAvatar(rig: AvatarRig, image: TexImageSource) {
    const gl = this.gl;
    this.rig = rig;
    this.staticBackground = false;
    const { width, height } = rig.imageSize;
    const scale = Math.min(1, 1280 / Math.max(width, height));
    this.canvas.width = Math.round(width * scale);
    this.canvas.height = Math.round(height * scale);

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rig.rest, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rig.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    if (this.groups) for (const group of Object.values(this.groups)) gl.deleteBuffer(group.buffer);
    const make = (indices: Uint16Array): Group => {
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      return { buffer, count: indices.length };
    };
    this.groups = { outer: make(rig.outerTriangles), eyes: make(rig.eyeTriangles), mouth: make(rig.mouthTriangles), face: make(rig.faceTriangles) };
  }

  /**
   * Keep the original background static. The matte decides which warped pixels are drawn; the plate is what
   * shows behind the subject. Pass null to animate the whole picture as one piece instead.
   */
  setBackground(input: StaticBackground | null) {
    const gl = this.gl;
    if (!input || !this.rig) {
      this.staticBackground = false;
      return;
    }
    const matte = this.singleChannel(input.matte, input.matteWidth, input.matteHeight);
    const hole = this.singleChannel(input.plate.hole, input.plate.width, input.plate.height);
    const fill = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, fill);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, input.plate.width, input.plate.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, input.plate.fill);
    this.linearClamp();

    // Bake both textures once, at the canvas (output) resolution.
    const { width, height } = this.canvas;
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, width, height);
    const p = this.bakeProgram;
    gl.useProgram(p);
    gl.uniform1f(gl.getUniformLocation(p, 'u_flip'), 0);
    gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);
    gl.uniform1i(gl.getUniformLocation(p, 'u_matte'), 1);
    gl.uniform1i(gl.getUniformLocation(p, 'u_fill'), 2);
    gl.uniform1i(gl.getUniformLocation(p, 'u_hole'), 3);
    gl.bindVertexArray(this.quadVao);
    for (const [mode, target] of [[0, this.plateTexture], [1, this.subjectTexture]] as const) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.linearClamp();
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      [this.texture, matte, fill, hole].forEach((t, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); });
      gl.uniform1i(gl.getUniformLocation(p, 'u_mode'), mode);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    for (const t of [matte, hole, fill]) gl.deleteTexture(t);
    gl.activeTexture(gl.TEXTURE0);
    this.staticBackground = true;
  }

  get hasStaticBackground() {
    return this.staticBackground;
  }

  render(positions: Float32Array, mouth: MouthFrame) {
    const gl = this.gl;
    const rig = this.rig;
    const groups = this.groups;
    if (!rig || !groups) return;
    const { width, height } = rig.imageSize;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    if (this.staticBackground) {
      // Pass 0: the background exactly where it is in the picture. Never deformed.
      gl.disable(gl.BLEND);
      gl.useProgram(this.copyProgram);
      gl.uniform1f(gl.getUniformLocation(this.copyProgram, 'u_flip'), 1);
      gl.uniform1i(gl.getUniformLocation(this.copyProgram, 'u_tex'), 0);
      gl.bindTexture(gl.TEXTURE_2D, this.plateTexture);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    } else {
      gl.disable(gl.BLEND);
    }

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);

    const setCommon = (p: WebGLProgram, minAlpha = 1, texture: WebGLTexture = this.texture) => {
      gl.useProgram(p);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform2f(gl.getUniformLocation(p, 'u_size'), width, height);
      gl.uniform2f(gl.getUniformLocation(p, 'u_zRange'), rig.zRange[0], rig.zRange[1]);
      gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0);
      const floor = gl.getUniformLocation(p, 'u_minAlpha');
      if (floor) gl.uniform1f(floor, minAlpha);
    };
    const draw = (group: Group) => {
      if (!group.count) return;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, group.buffer);
      gl.drawElements(gl.TRIANGLES, group.count, gl.UNSIGNED_SHORT, 0);
    };

    // Outer mesh: with a static background only the subject's pixels (matte in alpha) are drawn.
    if (this.staticBackground) setCommon(this.textureProgram, 0, this.subjectTexture);
    else setCommon(this.textureProgram, 1);
    draw(groups.outer);
    // Eyes, mouth and face are always the subject.
    setCommon(this.textureProgram, 1);
    draw(groups.eyes);

    setCommon(this.mouthProgram);
    const mp = this.mouthProgram;
    gl.uniform2f(gl.getUniformLocation(mp, 'u_origin'), mouth.origin.x, mouth.origin.y);
    gl.uniform2f(gl.getUniformLocation(mp, 'u_axisX'), mouth.axisX.x, mouth.axisX.y);
    gl.uniform2f(gl.getUniformLocation(mp, 'u_axisY'), mouth.axisY.x, mouth.axisY.y);
    gl.uniform1f(gl.getUniformLocation(mp, 'u_halfWidth'), mouth.halfWidth);
    gl.uniform1f(gl.getUniformLocation(mp, 'u_open'), mouth.open);
    gl.uniform1f(gl.getUniformLocation(mp, 'u_mix'), mouth.interiorMix);
    draw(groups.mouth);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    setCommon(this.textureProgram, 1);
    draw(groups.face);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /**
   * Neural mode: the portrait itself, untouched, with the generated face (LivePortrait, 512x512, aligned to
   * `crop` in portrait pixels) blended over the subject. The background is the original picture.
   */
  renderNeural(face: { bitmap: ImageBitmap; crop: FaceCrop; seq: number }) {
    const gl = this.gl;
    const rig = this.rig;
    if (!rig) return;
    const { width, height } = rig.imageSize;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(this.copyProgram);
    gl.uniform1f(gl.getUniformLocation(this.copyProgram, 'u_flip'), 1);
    gl.uniform1i(gl.getUniformLocation(this.copyProgram, 'u_tex'), 0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (face.seq !== this.neuralSeq) {
      gl.bindTexture(gl.TEXTURE_2D, this.neuralTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, face.bitmap);
      this.linearClamp();
      this.neuralSeq = face.seq;
    }
    const corners = cropCorners(face.crop);
    const uvs = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const data = new Float32Array(20);
    corners.forEach(([x, y], i) => data.set([x, y, 0.5, uvs[i][0], uvs[i][1]], i * 5));
    gl.bindVertexArray(this.neuralVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.neuralBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    const p = this.neuralProgram;
    gl.useProgram(p);
    gl.uniform2f(gl.getUniformLocation(p, 'u_size'), width, height);
    gl.uniform2f(gl.getUniformLocation(p, 'u_zRange'), 0, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.neuralTexture);
    gl.uniform1i(gl.getUniformLocation(p, 'u_face'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.plateTexture);
    gl.uniform1i(gl.getUniformLocation(p, 'u_region'), 1);
    gl.uniform1f(gl.getUniformLocation(p, 'u_useRegion'), this.staticBackground ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /** Virtual-camera frame of what was just rendered, as I420 (async: returns an earlier frame or null). */
  encodeI420(options: EncodeOptions): Uint8Array | null {
    this.encoder ??= new I420Encoder(this.gl);
    return this.encoder.encode(this.canvas.width, this.canvas.height, options);
  }

  dispose() {
    const gl = this.gl;
    this.encoder?.dispose();
    if (this.groups) for (const group of Object.values(this.groups)) gl.deleteBuffer(group.buffer);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.uvBuffer);
    gl.deleteBuffer(this.quadBuffer);
    for (const t of [this.texture, this.plateTexture, this.subjectTexture, this.neuralTexture]) gl.deleteTexture(t);
    gl.deleteBuffer(this.neuralBuffer);
    gl.deleteVertexArray(this.neuralVao);
    gl.deleteProgram(this.neuralProgram);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.quadVao);
    gl.deleteProgram(this.textureProgram);
    gl.deleteProgram(this.mouthProgram);
    gl.deleteProgram(this.copyProgram);
    gl.deleteProgram(this.bakeProgram);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
