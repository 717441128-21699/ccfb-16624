// 热气球热力学与飞行动力学
//
// 浮力(理想气体定律):
//   球内空气密度 rho_in = p / (R * T_in)      —— 温度越高越轻
//   净升力 L = (rho_amb - rho_in) * V * g - (干重 + 燃料) * g
//
// 热平衡(集总热容模型, 产生"燃烧器加热要过一会儿才上升"的滞后):
//   C_eff * dT/dt = Q_burner - (UA + k_mouth) * (T_in - T_amb) - Q_vent
//   C_eff = m_air * cp + 蒙皮等效热容
//
// 垂直方向(含附加质量, 产生大惯性):
//   (m_total + m_added) * dv/dt = L - 0.5 * rho * Cd * A * v|v|
//
// 水平方向: 气球无法转向, 随风飘(带水平惯性弛豫)

import { Atmosphere, CP_AIR, G0, R_AIR } from './atmosphere';

export interface BalloonConfig {
  volume: number;            // 球囊容积 m^3 (AX-8 级 ≈ 2800)
  dryMass: number;           // 干重(蒙皮+吊篮+燃烧器+乘员) kg
  maxTempC: number;          // 球内温度上限 ℃ (蒙皮许用温度)
  burnerPowerW: number;      // 燃烧器有效加热功率 W
  burnerFuelKgPerSec: number;// 燃烧器全开时丙烷消耗率 kg/s
  fabricHeatCapJK: number;   // 蒙皮等效热容 J/K
  uaWK: number;              // 蒙皮综合传热 UA W/K
  mouthLossWK: number;       // 球口换气等效换热 W/K
  ventTauS: number;          // 放气阀时间常数 s
  dragCd: number;            // 垂直阻力系数
  addedMassCoeff: number;    // 附加质量系数(球体 0.5)
  horizTauS: number;         // 水平弛豫时间 s
}

// 参数标定见 PHYSICS.md —— 对照热气球飞行手册经验值
export const DEFAULT_BALLOON: BalloonConfig = {
  volume: 2800,
  dryMass: 600,
  maxTempC: 120,
  burnerPowerW: 1.3e6,
  burnerFuelKgPerSec: 2.0 / 60,   // 全开 2.0 kg/min
  fabricHeatCapJK: 250e3,
  uaWK: 4200,
  mouthLossWK: 1300,
  ventTauS: 8,
  dragCd: 0.6,
  addedMassCoeff: 0.5,
  horizTauS: 6,
};

export interface EnvSample {
  tempK: number;     // 环境温度
  pressure: number;  // 压强 Pa
  density: number;   // 密度 kg/m^3
}

export class Balloon {
  tempK: number;      // 球内空气温度 K
  alt = 0;            // 海拔 m
  vy = 0;             // 垂直速度 m/s
  x = 0; z = 0;       // 水平位置 m
  vx = 0; vz = 0;     // 水平速度 m/s
  fuelKg: number;
  burnerOn = false;
  ventOpen = false;
  burnSeconds = 0;    // 累计开火时长(燃料正比于此)

  constructor(public cfg: BalloonConfig, startFuelKg: number) {
    this.fuelKg = startFuelKg;
    this.tempK = 288.15;
  }

  /** 球内空气质量 kg (理想气体状态方程) */
  airMass(pressure: number): number {
    return (pressure * this.cfg.volume) / (R_AIR * this.tempK);
  }

  /** 当前净升力 N (正=向上) */
  netLiftN(env: EnvSample): number {
    const rhoIn = env.pressure / (R_AIR * this.tempK);
    return (
      (env.density - rhoIn) * this.cfg.volume * G0 -
      (this.cfg.dryMass + this.fuelKg) * G0
    );
  }

  /** 悬浮(中性浮力)所需的球内温度 K */
  neutralTempK(env: EnvSample): number {
    const rhoNeeded = env.density - (this.cfg.dryMass + this.fuelKg) / this.cfg.volume;
    return env.pressure / (R_AIR * rhoNeeded);
  }

  update(dt: number, env: EnvSample, windX: number, windZ: number): void {
    const c = this.cfg;
    // ---- 热平衡 ----
    const mAir = this.airMass(env.pressure);
    const cEff = mAir * CP_AIR + c.fabricHeatCapJK;
    let q = 0;
    if (this.burnerOn && this.fuelKg > 0) {
      q += c.burnerPowerW;
      const used = Math.min(this.fuelKg, c.burnerFuelKgPerSec * dt);
      this.fuelKg -= used;
      this.burnSeconds += used / c.burnerFuelKgPerSec;
    }
    q -= (c.uaWK + c.mouthLossWK) * (this.tempK - env.tempK);
    if (this.ventOpen) {
      // 顶部放气阀: 热空气快速外泄
      q -= (cEff * (this.tempK - env.tempK)) / c.ventTauS;
    }
    this.tempK += (q / cEff) * dt;
    const tMax = c.maxTempC + 273.15;
    if (this.tempK > tMax) this.tempK = tMax;
    if (this.tempK < env.tempK) this.tempK = env.tempK;

    // ---- 垂直动力学 ----
    const lift = this.netLiftN(env);
    const r = Math.cbrt((3 * c.volume) / (4 * Math.PI));
    const area = Math.PI * r * r;
    const drag = 0.5 * env.density * c.dragCd * area * this.vy * Math.abs(this.vy);
    const mTotal =
      c.dryMass + this.fuelKg + this.airMass(env.pressure) +
      c.addedMassCoeff * env.density * c.volume;
    this.vy += ((lift - drag) / mTotal) * dt;
    this.alt += this.vy * dt;

    // ---- 水平运动: 随风, 带惯性弛豫 ----
    const k = 1 - Math.exp(-dt / c.horizTauS);
    this.vx += (windX - this.vx) * k;
    this.vz += (windZ - this.vz) * k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
  }
}

/** 由大气对象取环境样本 */
export function sampleEnv(atmo: Atmosphere, alt: number): EnvSample {
  return {
    tempK: atmo.temperature(alt),
    pressure: atmo.pressure(alt),
    density: atmo.density(alt),
  };
}
