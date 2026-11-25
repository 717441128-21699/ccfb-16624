// 飞行实体: 测风气球(pibal) 与 标志袋(marker)

import { G0 } from './atmosphere';
import { WindProfile } from './wind';

/** 测风气球: 以近似恒定速率上升, 水平随风漂移, 用于探测各层风 */
export class Pibal {
  vx = 0; vz = 0;
  riseRate = 3.0;      // 上升速率 m/s
  maxAlt = 0;          // 到达过的最大高度(决定已探测的风层)
  active = true;
  constructor(public x: number, public z: number, public alt: number) {
    this.maxAlt = alt;
  }
  update(dt: number, wind: WindProfile, tSec: number, ceiling: number): void {
    if (!this.active) return;
    this.alt += this.riseRate * dt;
    if (this.alt >= ceiling) { this.active = false; return; }
    const w = wind.sample(this.alt, tSec);
    const k = 1 - Math.exp(-dt / 2.5);
    this.vx += (w.x - this.vx) * k;
    this.vz += (w.z - this.vz) * k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (this.alt > this.maxAlt) this.maxAlt = this.alt;
  }
}

/** 标志袋: 自由落体 + 阻力(末速度 ≈ 12 m/s), 下落过程中随各层风漂移 */
export class Marker {
  vx: number; vz: number; vy: number;
  landed = false;
  landX = 0; landZ = 0;
  static readonly TERMINAL_V = 12; // 末速度 m/s (小沙袋+飘带)
  constructor(x: number, z: number, public alt: number, vx: number, vz: number) {
    this.vx = vx; this.vz = vz; this.vy = 0;
    this.x = x; this.z = z;
  }
  x: number; z: number;
  update(dt: number, wind: WindProfile, tSec: number, heightAt: (x: number, z: number) => number): void {
    if (this.landed) return;
    // 垂直: 二次阻力, 末速度 TERMINAL_V
    const k = G0 / (Marker.TERMINAL_V * Marker.TERMINAL_V);
    this.vy += (-G0 + k * this.vy * Math.abs(this.vy)) * dt;
    // 水平: 快速弛豫到所在高度风
    const w = wind.sample(this.alt, tSec);
    const kr = 1 - Math.exp(-dt / 2.0);
    this.vx += (w.x - this.vx) * kr;
    this.vz += (w.z - this.vz) * kr;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.alt += this.vy * dt;
    const ground = heightAt(this.x, this.z);
    if (this.alt <= ground) {
      this.alt = ground;
      this.landed = true;
      this.landX = this.x;
      this.landZ = this.z;
    }
  }
}
