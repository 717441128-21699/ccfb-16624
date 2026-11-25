// 赛区定义: 地形、风廓线、逆温层、目标点、高压线 (均为虚构)

import { WindLayer } from './wind';
import { Inversion } from './atmosphere';

export interface PowerLineSeg {
  ax: number; az: number;  // 起点 (世界坐标 m)
  bx: number; bz: number;  // 终点
  height: number;          // 导线距地面高度 m
}

export interface Venue {
  id: string;
  name: string;
  desc: string;
  difficulty: string;
  halfSize: number;                 // 场地半宽 m (世界为 [-half, +half]^2)
  waterLevel: number | null;        // 水面海拔 m (无则 null)
  seaLevelTempC: number;
  lapseRate: number;
  inversion: Inversion;
  wind: WindLayer[];
  launch: { x: number; z: number };
  target: { x: number; z: number };
  powerLines: PowerLineSeg[];
  timeLimitSec: number;
  fuelKg: number;
  pibalCount: number;
  markerCount: number;
  heightAt(x: number, z: number): number;
}

function gauss(d: number, s: number): number {
  return Math.exp(-(d * d) / (2 * s * s));
}

// ---------- 赛区一: 晨雾河谷 ----------
// 南北向河谷, 两侧丘陵; 低空逆温强, 近地面几乎静风, 上层东北风转北风
const valley: Venue = {
  id: 'valley',
  name: '晨雾河谷',
  desc: '南北向河谷, 两侧丘陵夹峙。清晨河谷逆温强, 地面近乎静风; 400 m 以上进入梯度风, 风向随高度由东北转向西北。高压线横跨河谷, 进近目标时注意。',
  difficulty: '★★☆ 适合新手',
  halfSize: 4000,
  waterLevel: 40.5,
  seaLevelTempC: 12,
  lapseRate: 0.0065,
  inversion: { base: 180, top: 400, strength: 5 },
  wind: [
    { alt: 0,    dirFromDeg: 160, speed: 0.8 },
    { alt: 150,  dirFromDeg: 140, speed: 1.2 },
    { alt: 350,  dirFromDeg: 90,  speed: 2.0 },
    { alt: 500,  dirFromDeg: 45,  speed: 3.5 },
    { alt: 800,  dirFromDeg: 30,  speed: 5.0 },
    { alt: 1200, dirFromDeg: 10,  speed: 6.5 },
    { alt: 1600, dirFromDeg: 340, speed: 8.0 },
  ],
  launch: { x: -300, z: 2400 },
  target: { x: 350, z: -1500 },
  powerLines: [
    { ax: -2600, az: 300, bx: 2600, bz: 500, height: 26 },
    { ax: -1800, az: -900, bx: 2400, bz: -700, height: 24 },
  ],
  timeLimitSec: 30 * 60,
  fuelKg: 60,
  pibalCount: 3,
  markerCount: 2,
  heightAt(x: number, z: number): number {
    const side = Math.max(0, Math.abs(x) - 700) / 1300;
    let h = 48 + 170 * side * side;
    h += 25 * Math.sin(x * 0.004 + 1.7) * Math.sin(z * 0.003) * Math.min(1, side + 0.15);
    h += 5 * Math.sin(z * 0.0016 + 0.5);
    // 河道下切(低于水面形成河流)
    h -= 10 * gauss(x, 180);
    return h;
  },
};

// ---------- 赛区二: 丘陵麦田 ----------
// 起伏丘陵, 南风随高度顺转成西风, 中层风大
const hills: Venue = {
  id: 'hills',
  name: '丘陵麦田',
  desc: '麦收后的丘陵地, 地形起伏 150 m。地面南风微弱, 向上顺转: 600 m 西南风, 1200 m 以上西风强劲。逆温层在 450–600 m, 穿越时风向突变, 是转向的关键层。',
  difficulty: '★★★ 需要多层切换',
  halfSize: 4000,
  waterLevel: null,
  seaLevelTempC: 14,
  lapseRate: 0.006,
  inversion: { base: 450, top: 600, strength: 3.5 },
  wind: [
    { alt: 0,    dirFromDeg: 190, speed: 1.5 },
    { alt: 200,  dirFromDeg: 180, speed: 2.0 },
    { alt: 450,  dirFromDeg: 170, speed: 2.5 },
    { alt: 620,  dirFromDeg: 220, speed: 4.5 },
    { alt: 900,  dirFromDeg: 250, speed: 6.0 },
    { alt: 1300, dirFromDeg: 265, speed: 8.5 },
    { alt: 1700, dirFromDeg: 280, speed: 10.0 },
  ],
  launch: { x: -2400, z: 1800 },
  target: { x: 1600, z: -900 },
  powerLines: [
    { ax: -800, az: 2600, bx: -200, bz: -2600, height: 28 },
    { ax: 600, az: 400, bx: 2800, bz: -200, height: 25 },
  ],
  timeLimitSec: 28 * 60,
  fuelKg: 55,
  pibalCount: 3,
  markerCount: 2,
  heightAt(x: number, z: number): number {
    let h = 95;
    h += 55 * Math.sin(x * 0.0011 + 0.8) * Math.cos(z * 0.0013 - 0.4);
    h += 30 * Math.sin(x * 0.0031 - 1.2) * Math.sin(z * 0.0027 + 2.1);
    h += 12 * Math.sin(x * 0.008 + 3.0) * Math.cos(z * 0.009);
    return h;
  },
};

// ---------- 赛区三: 湖畔平原 ----------
// 西侧大湖, 湖风效应: 低层湖风(东风), 高层梯度风(西南转南), 风向随高度逆转
const lake: Venue = {
  id: 'lake',
  name: '湖畔平原',
  desc: '西侧开阔湖面, 清晨湖风把低空气流推向岸边(东风), 600 m 以上梯度风转为南风再转西南——风向随高度"逆转", 可用不同高度实现往返。湖西侧有高压线走廊。',
  difficulty: '★★★★ 风向逆转, 规划复杂',
  halfSize: 4000,
  waterLevel: 28,
  seaLevelTempC: 15,
  lapseRate: 0.006,
  inversion: { base: 300, top: 480, strength: 4.5 },
  wind: [
    { alt: 0,    dirFromDeg: 250, speed: 1.8 },
    { alt: 250,  dirFromDeg: 260, speed: 2.6 },
    { alt: 500,  dirFromDeg: 200, speed: 3.2 },
    { alt: 700,  dirFromDeg: 170, speed: 4.5 },
    { alt: 1000, dirFromDeg: 150, speed: 6.0 },
    { alt: 1400, dirFromDeg: 210, speed: 7.5 },
    { alt: 1800, dirFromDeg: 230, speed: 9.0 },
  ],
  launch: { x: -1200, z: -2000 },
  target: { x: 900, z: 1400 },
  powerLines: [
    { ax: -2800, az: -800, bx: -400, bz: 800, height: 30 },
    { ax: 1800, az: -2600, bx: 2200, bz: 2600, height: 26 },
  ],
  timeLimitSec: 32 * 60,
  fuelKg: 60,
  pibalCount: 4,
  markerCount: 2,
  heightAt(x: number, z: number): number {
    // 西侧(x < -1500)为湖面
    let h = 34 + 14 * Math.sin(x * 0.0015 + 0.4) * Math.sin(z * 0.0012);
    h += 8 * Math.sin(x * 0.005 - 1.0) * Math.cos(z * 0.004 + 0.8);
    h += 40 * gauss(x - 2600, 700) * gauss(z + 2000, 900); // 东南角高地
    const lakeDip = 14 * (1 - Math.min(1, Math.max(0, (x + 1500) / 500)));
    h -= lakeDip;
    return h;
  },
};

export const VENUES: Venue[] = [valley, hills, lake];
