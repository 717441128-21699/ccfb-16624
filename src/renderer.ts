// WebGL2 渲染器: 地形 / 气球 / 目标区 / 高压线 / 测风气球 / 标志袋

import {
  Vec3, mat4LookAt, mat4Perspective, mat4TranslateScale, clamp,
} from './math';
import { Venue } from './venues';

const VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aNorm;
in vec3 aColor;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
out vec3 vNorm;
out vec3 vColor;
out vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNorm = mat3(uModel) * aNorm;
  vColor = aColor;
  gl_Position = uProj * uView * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vNorm;
in vec3 vColor;
in vec3 vWorld;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uEmissive;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNorm);
  float diff = max(dot(n, normalize(uSunDir)), 0.0);
  vec3 ambient = vec3(0.42, 0.44, 0.50);
  vec3 sun = vec3(1.0, 0.93, 0.80) * diff * 0.85;
  vec3 col = vColor * (ambient + sun) + vColor * uEmissive;
  float d = distance(vWorld, uCamPos);
  float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  outColor = vec4(mix(col, uFogColor, clamp(f, 0.0, 1.0)), 1.0);
}`;

export interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
  mode: number;
}

export class Renderer {
  gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uProj: WebGLUniformLocation | null;
  private uView: WebGLUniformLocation | null;
  private uModel: WebGLUniformLocation | null;
  private uSunDir: WebGLUniformLocation | null;
  private uCamPos: WebGLUniformLocation | null;
  private uFogColor: WebGLUniformLocation | null;
  private uFogDensity: WebGLUniformLocation | null;
  private uEmissive: WebGLUniformLocation | null;

  fogColor: Vec3 = [0.78, 0.82, 0.90];
  fogDensity = 0.00016;
  sunDir: Vec3 = [0.75, 0.5, 0.35]; // 清晨低角度阳光(偏东)

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.prog = this.compile(VS, FS);
    gl.useProgram(this.prog);
    const loc = (n: string) => gl.getUniformLocation(this.prog, n);
    this.uProj = loc('uProj'); this.uView = loc('uView'); this.uModel = loc('uModel');
    this.uSunDir = loc('uSunDir'); this.uCamPos = loc('uCamPos');
    this.uFogColor = loc('uFogColor'); this.uFogDensity = loc('uFogDensity');
    this.uEmissive = loc('uEmissive');
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  private compile(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      }
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aNorm');
    gl.bindAttribLocation(p, 2, 'aColor');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Link: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  createMesh(pos: number[], norm: number[], col: number[], idx: number[], mode?: number): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = (loc: number, data: number[]) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    };
    buf(0, pos); buf(1, norm); buf(2, col);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: idx.length, mode: mode ?? gl.TRIANGLES };
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  begin(eye: Vec3, center: Vec3): void {
    const gl = this.gl;
    this.resize();
    gl.clearColor(this.fogColor[0], this.fogColor[1], this.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    gl.uniformMatrix4fv(this.uProj, false, mat4Perspective(0.9, aspect, 1, 20000));
    gl.uniformMatrix4fv(this.uView, false, mat4LookAt(eye, center, [0, 1, 0]));
    gl.uniform3fv(this.uSunDir, this.sunDir);
    gl.uniform3fv(this.uCamPos, eye);
    gl.uniform3fv(this.uFogColor, this.fogColor);
    gl.uniform1f(this.uFogDensity, this.fogDensity);
  }

  draw(mesh: Mesh, model: Float32Array, emissive = 0): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.uModel, false, model);
    gl.uniform1f(this.uEmissive, emissive);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(mesh.mode, mesh.count, gl.UNSIGNED_INT, 0);
  }
}

// ---------------- 网格构建 ----------------

export function buildSphere(latSeg: number, lonSeg: number, colorFn: (lonFrac: number, latFrac: number) => Vec3): { pos: number[]; norm: number[]; col: number[]; idx: number[] } {
  const pos: number[] = [], norm: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i <= latSeg; i++) {
    const th = (i / latSeg) * Math.PI;
    for (let j = 0; j <= lonSeg; j++) {
      const ph = (j / lonSeg) * 2 * Math.PI;
      const x = Math.sin(th) * Math.cos(ph);
      const y = Math.cos(th);
      const z = Math.sin(th) * Math.sin(ph);
      pos.push(x, y, z);
      norm.push(x, y, z);
      const c = colorFn(j / lonSeg, i / latSeg);
      col.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i < latSeg; i++) {
    for (let j = 0; j < lonSeg; j++) {
      const a = i * (lonSeg + 1) + j, b = a + lonSeg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { pos, norm, col, idx };
}

export function buildBox(color: Vec3): { pos: number[]; norm: number[]; col: number[]; idx: number[] } {
  // 单位立方体 [-0.5, 0.5]^3
  const pos: number[] = [], norm: number[] = [], col: number[] = [], idx: number[] = [];
  const faces: [Vec3, Vec3, Vec3, Vec3, Vec3][] = [
    [[0, 0, 1], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
    [[0, 0, -1], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]],
    [[1, 0, 0], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]],
    [[-1, 0, 0], [-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]],
    [[0, 1, 0], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]],
    [[0, -1, 0], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]],
  ];
  for (const [n, a, b, c, d] of faces) {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) {
      pos.push(v[0], v[1], v[2]);
      norm.push(n[0], n[1], n[2]);
      col.push(color[0], color[1], color[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos, norm, col, idx };
}

export function buildTerrain(venue: Venue, gridN = 150): { pos: number[]; norm: number[]; col: number[]; idx: number[] } {
  const pos: number[] = [], norm: number[] = [], col: number[] = [], idx: number[] = [];
  const half = venue.halfSize;
  const step = (2 * half) / gridN;
  const H = (x: number, z: number) => venue.heightAt(x, z);
  for (let i = 0; i <= gridN; i++) {
    for (let j = 0; j <= gridN; j++) {
      const x = -half + j * step, z = -half + i * step;
      const h = H(x, z);
      pos.push(x, h, z);
      // 中心差分法线
      const hx = H(x + step, z) - H(x - step, z);
      const hz = H(x, z + step) - H(x, z - step);
      let nx = -hx / (2 * step), ny = 1, nz = -hz / (2 * step);
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      norm.push(nx, ny, nz);
      // 着色: 草地/农田/岩石/沙岸
      const slope = 1 - ny;
      const wl = venue.waterLevel;
      let r: number, g: number, b: number;
      if (wl !== null && h < wl + 1.2) {
        r = 0.72; g = 0.66; b = 0.45; // 滩涂
      } else if (slope > 0.35) {
        r = 0.45; g = 0.42; b = 0.38; // 岩石
      } else {
        const field = Math.sin(x * 0.011) * Math.sin(z * 0.013);
        if (field > 0.35) { r = 0.72; g = 0.62; b = 0.30; }        // 麦田
        else if (field < -0.4) { r = 0.20; g = 0.38; b = 0.16; }   // 树林
        else { r = 0.32; g = 0.52; b = 0.22; }                      // 草地
        const v = 1 + 0.08 * Math.sin(x * 0.05) * Math.cos(z * 0.06);
        r *= v; g *= v; b *= v;
      }
      col.push(r, g, b);
    }
  }
  for (let i = 0; i < gridN; i++) {
    for (let j = 0; j < gridN; j++) {
      const a = i * (gridN + 1) + j, b2 = a + gridN + 1;
      idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
    }
  }
  return { pos, norm, col, idx };
}

/** 目标区同心圆环 (贴合地形) */
export function buildTargetRings(venue: Venue): { pos: number[]; norm: number[]; col: number[]; idx: number[] } {
  const pos: number[] = [], norm: number[] = [], col: number[] = [], idx: number[] = [];
  const radii = [2.5, 7.5, 15, 25, 40];
  const colors: Vec3[] = [[0.9, 0.1, 0.1], [0.95, 0.95, 0.95], [0.9, 0.1, 0.1], [0.95, 0.95, 0.95], [0.9, 0.1, 0.1]];
  const seg = 64;
  const { x: cx, z: cz } = venue.target;
  let prevR = 0;
  for (let ring = 0; ring < radii.length; ring++) {
    const r0 = prevR, r1 = radii[ring];
    prevR = r1;
    const c = colors[ring];
    const base = pos.length / 3;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * 2 * Math.PI;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (const r of [r0, r1]) {
        const x = cx + ca * r, z = cz + sa * r;
        pos.push(x, venue.heightAt(x, z) + 0.25, z);
        norm.push(0, 1, 0);
        col.push(c[0], c[1], c[2]);
      }
    }
    for (let j = 0; j < seg; j++) {
      const a = base + j * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return { pos, norm, col, idx };
}

/** 折线顶点序列 -> LINES 线段数组 */
export function polylineToLines(pts: Vec3[], color: Vec3): { pos: number[]; norm: number[]; col: number[]; idx: number[] } {
  const pos: number[] = [], norm: number[] = [], col: number[] = [], idx: number[] = [];
  for (const p of pts) {
    pos.push(p[0], p[1], p[2]);
    norm.push(0, 1, 0);
    col.push(color[0], color[1], color[2]);
  }
  for (let i = 0; i + 1 < pts.length; i++) idx.push(i, i + 1);
  return { pos, norm, col, idx };
}

export { mat4TranslateScale, clamp };
