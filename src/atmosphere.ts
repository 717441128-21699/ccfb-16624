// 大气模型: ISA 标准大气 + 逆温层
// 温度廓线: T(z) = T0 - L*z + 逆温增量
// 压强: 沿温度廓线数值积分静力学方程 dp/dz = -rho*g

import { clamp } from './math';

export const R_AIR = 287.05;   // 干空气气体常数 J/(kg·K)
export const G0 = 9.80665;     // 重力加速度 m/s^2
export const P0 = 101325;      // 海平面标准压强 Pa
export const CP_AIR = 1005;    // 空气定压比热 J/(kg·K)

export interface Inversion {
  base: number;      // 逆温层底高度 m
  top: number;       // 逆温层顶高度 m
  strength: number;  // 穿过逆温层的总温升 K
}

export interface AtmosphereOptions {
  seaLevelTempC: number;  // 海平面温度 ℃
  lapseRate: number;      // 递减率 K/m (ISA: 0.0065)
  inversion?: Inversion;
}

export class Atmosphere {
  readonly step = 10;
  readonly maxAlt = 3000;
  private tTab: Float32Array;
  private pTab: Float32Array;
  private rhoTab: Float32Array;

  constructor(public opts: AtmosphereOptions) {
    const n = Math.floor(this.maxAlt / this.step) + 1;
    this.tTab = new Float32Array(n);
    this.pTab = new Float32Array(n);
    this.rhoTab = new Float32Array(n);
    const T0 = opts.seaLevelTempC + 273.15;
    let p = P0;
    for (let i = 0; i < n; i++) {
      const z = i * this.step;
      let T = T0 - opts.lapseRate * z;
      if (opts.inversion) {
        const inv = opts.inversion;
        const f = clamp((z - inv.base) / (inv.top - inv.base), 0, 1);
        T += inv.strength * f;
      }
      if (i > 0) {
        const Tprev = this.tTab[i - 1];
        // 静力学方程积分(等温分层近似)
        p = p * Math.exp((-G0 * this.step) / (R_AIR * ((T + Tprev) / 2)));
      }
      this.tTab[i] = T;
      this.pTab[i] = p;
      this.rhoTab[i] = p / (R_AIR * T);
    }
  }

  private sample(tab: Float32Array, z: number): number {
    const zz = clamp(z, 0, this.maxAlt);
    const fi = zz / this.step;
    const i = Math.floor(fi);
    if (i >= tab.length - 1) return tab[tab.length - 1];
    const t = fi - i;
    return tab[i] * (1 - t) + tab[i + 1] * t;
  }

  /** 环境温度 K */
  temperature(z: number): number { return this.sample(this.tTab, z); }
  /** 压强 Pa */
  pressure(z: number): number { return this.sample(this.pTab, z); }
  /** 密度 kg/m^3 (理想气体: rho = p / (R T)) */
  density(z: number): number { return this.sample(this.rhoTab, z); }
}
