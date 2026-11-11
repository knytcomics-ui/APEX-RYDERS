import Phaser from 'phaser';

/** The tiny drawing surface the world painters need. */
export interface Painter {
  fillStyle(color: number, alpha?: number): void;
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void;
}

const VERT = `
attribute vec2 aPos;
attribute vec4 aCol;
uniform vec4 uView; // 2/w, -2/h, offsetX, offsetY
varying vec4 vCol;
void main() {
  vCol = aCol;
  gl_Position = vec4((aPos.x + uView.z) * uView.x - 1.0, (aPos.y + uView.w) * uView.y + 1.0, 0.0, 1.0);
}`;
const FRAG = `
precision mediump float;
varying vec4 vCol;
void main() { gl_FragColor = vCol; }`;

/**
 * Flat-colour triangle batcher drawn inside Phaser's display list (via an Extern
 * game object). The world is thousands of small cel-shaded polygons per frame;
 * pushing them through Phaser.Graphics costs microseconds each, while this writes
 * straight into one typed array and issues a single draw call per layer.
 */
export class TriBatch implements Painter {
  private buf = new ArrayBuffer(12 * 3 * 16384);
  private f32 = new Float32Array(this.buf);
  private u32 = new Uint32Array(this.buf);
  private n = 0; // vertices written
  private color = 0xffffffff;
  private program: WebGLProgram | null = null;
  private vbo: WebGLBuffer | null = null;
  private uView: WebGLUniformLocation | null = null;
  private gl: WebGLRenderingContext | null = null;

  constructor(scene: Phaser.Scene, depth: number) {
    const ext = scene.add.extern();
    ext.setDepth(depth);
    (ext as unknown as { render: (r: Phaser.Renderer.WebGL.WebGLRenderer, c: Phaser.Cameras.Scene2D.Camera) => void }).render = (r, c) => this.flush(r, c);
  }

  clear() { this.n = 0; }

  /** Colour as 0xRRGGBB plus alpha; stored premultiplied to match Phaser's blending. */
  fillStyle(color: number, alpha = 1) {
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    const r = (((color >> 16) & 255) * a) | 0, g = (((color >> 8) & 255) * a) | 0, b = ((color & 255) * a) | 0;
    this.color = (((a * 255) | 0) << 24) | (b << 16) | (g << 8) | r;
  }

  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    let i = this.n * 3;
    if (i + 9 > this.f32.length) this.grow();
    const f = this.f32, u = this.u32, c = this.color;
    f[i] = x1; f[i + 1] = y1; u[i + 2] = c;
    f[i + 3] = x2; f[i + 4] = y2; u[i + 5] = c;
    f[i + 6] = x3; f[i + 7] = y3; u[i + 8] = c;
    this.n += 3;
    i += 9;
  }

  fillRect(x: number, y: number, w: number, h: number) {
    this.fillTriangle(x, y, x + w, y, x + w, y + h);
    this.fillTriangle(x, y, x + w, y + h, x, y + h);
  }

  private grow() {
    const next = new ArrayBuffer(this.buf.byteLength * 2);
    new Uint32Array(next).set(this.u32);
    this.buf = next;
    this.f32 = new Float32Array(next);
    this.u32 = new Uint32Array(next);
  }

  private init(gl: WebGLRenderingContext) {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aCol');
    gl.linkProgram(p);
    this.program = p;
    this.uView = gl.getUniformLocation(p, 'uView');
    this.vbo = gl.createBuffer();
    this.gl = gl;
  }

  private flush(renderer: Phaser.Renderer.WebGL.WebGLRenderer, camera: Phaser.Cameras.Scene2D.Camera) {
    if (!this.n) return;
    const gl = renderer.gl;
    if (this.gl !== gl) this.init(gl);
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    const prevBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    const vao = (renderer as unknown as { vaoExtension?: { bindVertexArrayOES(v: null): void } }).vaoExtension;
    if (vao) vao.bindVertexArrayOES(null);

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.f32.subarray(0, this.n * 3), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 12, 8);
    // camera.matrix carries screen-shake offsets
    const m = (camera as unknown as { matrix: Phaser.GameObjects.Components.TransformMatrix }).matrix;
    gl.uniform4f(this.uView, 2 / renderer.width, -2 / renderer.height, m.tx, m.ty);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, this.n);

    gl.bindBuffer(gl.ARRAY_BUFFER, prevBuffer);
    gl.useProgram(prevProgram);
  }
}
