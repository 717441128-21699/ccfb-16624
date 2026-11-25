// 风廓线模型: 分层控制点 + 矢量插值 + 小尺度湍流脉动
// 清晨边界层特征: 近地面风小(地面摩擦+逆温层阻隔动量下传), 上层风大

import { bearingToVec, clamp, lerp, smoothstep01, vecToBearing } from './math';

export interface WindLayer {
  alt: number;        // 高度 m (AGL, 相对赛区地面基准)
  dirFromDeg: number; // 风向(来向, 度, 0=北风)
  speed: number;      // 风速 m/s
}

export interface WindVec {
  x: number;          // 东向分量 m/s
  z: number;          // 南向分量 m/s
  speed: number;
  dirFromDeg: number;
}

export class WindProfile {
  private layers: WindLayer[];
  constructor(layers: WindLayer[]) {
    this.layers = [...layers].sort((a, b) => a.alt - b.alt);
  }

  private toVec(l: WindLayer): WindVec {
    const v = bearingToVec(l.dirFromDeg + 180); // 风吹往的方向
    return { x: v[0] * l.speed, z: v[1] * l.speed, speed: l.speed, dirFromDeg: l.dirFromDeg };
  }

  /** 无湍流的平均风 */
  meanAt(alt: number): WindVec {
    const ls = this.layers;
    if (alt <= ls[0].alt) return this.toVec(ls[0]);
    const last = ls[ls.length - 1];
    if (alt >= last.alt) return this.toVec(last);
    let i = 0;
    while (i < ls.length - 2 && ls[i + 1].alt <= alt) i++;
    const a = ls[i], b = ls[i + 1];
    const t = smoothstep01((alt - a.alt) / (b.alt - a.alt));
    const va = bearingToVec(a.dirFromDeg + 180); // 风吹往的方向
    const vb = bearingToVec(b.dirFromDeg + 180);
    const x = lerp(va[0] * a.speed, vb[0] * b.speed, t);
    const z = lerp(va[1] * a.speed, vb[1] * b.speed, t);
    const speed = Math.hypot(x, z);
    return { x, z, speed, dirFromDeg: (vecToBearing(x, z) + 180) % 360 };
  }

  /** 含湍流脉动的瞬时风 (timeSec 为飞行时间) */
  sample(alt: number, timeSec: number): WindVec {
    const m = this.meanAt(alt);
    // 近地面湍流弱(清晨稳定层结), 高空略强
    const gustAmp = 0.25 + clamp(alt / 800, 0, 1) * 0.55;
    const gx = gustAmp * (Math.sin(timeSec * 0.43 + alt * 0.011) + 0.5 * Math.sin(timeSec * 1.1 + 2.0));
    const gz = gustAmp * (Math.cos(timeSec * 0.37 + alt * 0.013) + 0.5 * Math.cos(timeSec * 0.9 + 1.0));
    const x = m.x + gx * 0.5, z = m.z + gz * 0.5;
    const speed = Math.hypot(x, z);
    return { x, z, speed, dirFromDeg: (vecToBearing(x, z) + 180) % 360 };
  }
}
