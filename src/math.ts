// 基础数学工具:向量/矩阵(列主序 mat4, 供 WebGL 使用)

export type Vec3 = [number, number, number];

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function smoothstep01(t: number): number {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

export function mat4Identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function mat4LookAt(eye: Vec3, c: Vec3, up: Vec3): Float32Array {
  let zx = eye[0] - c[0], zy = eye[1] - c[1], zz = eye[2] - c[2];
  let l = Math.hypot(zx, zy, zz);
  zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = mat4Identity();
  m[0] = xx; m[4] = xy; m[8] = xz;
  m[1] = yx; m[5] = yy; m[9] = yz;
  m[2] = zx; m[6] = zy; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  return m;
}

export function mat4TranslateScale(
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
): Float32Array {
  const m = mat4Identity();
  m[0] = sx; m[5] = sy; m[10] = sz;
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/** 方位角(度, 顺时针, 0=北) -> 世界水平单位向量 (x 东, z 南, 北 = -z) */
export function bearingToVec(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), -Math.cos(r)];
}

/** 世界水平向量 -> 方位角(度) */
export function vecToBearing(x: number, z: number): number {
  return ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
}
