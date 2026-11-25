// 飞行场景: 物理主循环 + 输入 + 渲染 + HUD + 碰撞 + 计分

import { Atmosphere } from './atmosphere';
import { Balloon, DEFAULT_BALLOON, sampleEnv } from './balloon';
import { WindProfile } from './wind';
import { Venue } from './venues';
import { Marker, Pibal } from './entities';
import {
  Renderer, Mesh, buildSphere, buildBox, buildTerrain, buildTargetRings, polylineToLines,
} from './renderer';
import { Vec3, mat4TranslateScale, clamp, vecToBearing } from './math';
import { dirName, drawWindPage, fillResults, fmtTime, showScreen } from './ui';

const BASKET_DROP = 13;      // 吊篮底部相对球心高度 m
const ENVELOPE_TOP = 10;     // 球顶相对球心高度 m
const PIBAL_CEILING = 1700;  // 测风气球探测上限 m

export type FlightEnd = 'wire' | 'landed' | 'timeout' | 'oob' | null;

export class FlightGame {
  private atmo: Atmosphere;
  private wind: WindProfile;
  private balloon: Balloon;
  private pibals: Pibal[] = [];
  private markers: Marker[] = [];
  private timeSec = 0;
  private timeScale = 1;
  private end: FlightEnd = null;
  private hasFlown = false;
  private maxAlt = 0;
  private measuredUpTo = 0;
  private balloonLayers = new Set<number>();
  private fuelStart: number;
  private pibalsLeft: number;
  private markersLeft: number;
  private windPageOpen = false;

  // 相机
  private camYaw = 2.4;
  private camPitch = 0.22;
  private camDist = 70;

  // 网格
  private mTerrain: Mesh;
  private mWater: Mesh | null = null;
  private mTarget: Mesh;
  private mPole: Mesh;
  private mWires: Mesh;
  private mEnvelope: Mesh;
  private mBasket: Mesh;
  private mRopes: Mesh;
  private mPibal: Mesh;
  private mMarker: Mesh;
  private mFlame: Mesh;
  private mFlag: Mesh;
  private poleTops: { x: number; z: number; top: number }[] = [];
  private wireSpans: { x: number; z: number; top: number }[][] = [];

  private msgTimer = 0;
  private raf = 0;
  private lastT = 0;
  private destroyed = false;

  constructor(
    private venue: Venue,
    private renderer: Renderer,
    private onExit: () => void,
  ) {
    this.atmo = new Atmosphere({
      seaLevelTempC: venue.seaLevelTempC,
      lapseRate: venue.lapseRate,
      inversion: venue.inversion,
    });
    this.wind = new WindProfile(venue.wind);
    this.balloon = new Balloon(DEFAULT_BALLOON, venue.fuelKg);
    this.fuelStart = venue.fuelKg;
    this.pibalsLeft = venue.pibalCount;
    this.markersLeft = venue.markerCount;

    const g = venue.heightAt(venue.launch.x, venue.launch.z);
    this.balloon.x = venue.launch.x;
    this.balloon.z = venue.launch.z;
    this.balloon.alt = g + BASKET_DROP;
    // 起飞前已预加热到接近悬浮温度
    this.balloon.tempK = this.balloon.neutralTempK(sampleEnv(this.atmo, this.balloon.alt)) - 9;

    const gl = renderer.gl;
    this.mTerrain = renderer.createMesh(...spread(buildTerrain(venue)));
    if (venue.waterLevel !== null) {
      this.mWater = renderer.createMesh(...spread(buildBox([0.16, 0.33, 0.50])));
    }
    this.mTarget = renderer.createMesh(...spread(buildTargetRings(venue)));
    this.mPole = renderer.createMesh(...spread(buildBox([0.35, 0.35, 0.38])));
    this.mFlag = renderer.createMesh(...spread(buildBox([0.95, 0.15, 0.15])));
    this.mEnvelope = renderer.createMesh(...spread(buildSphere(20, 24, (lon) => {
      const gore = Math.floor(lon * 8) % 4;
      const cs: Vec3[] = [[0.85, 0.12, 0.16], [1.0, 0.78, 0.10], [0.12, 0.30, 0.80], [0.93, 0.93, 0.90]];
      return cs[gore];
    })));
    this.mBasket = renderer.createMesh(...spread(buildBox([0.55, 0.40, 0.24])));
    this.mPibal = renderer.createMesh(...spread(buildSphere(10, 12, () => [1.0, 0.55, 0.10])));
    this.mMarker = renderer.createMesh(...spread(buildBox([0.9, 0.1, 0.1])));
    this.mFlame = renderer.createMesh(...spread(buildSphere(8, 10, () => [1.0, 0.62, 0.10])));
    // 吊绳(气球局部坐标)
    const ropePts: Vec3[] = [];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      ropePts.push([sx * 4.6, -6.8, sz * 4.6], [sx * 0.8, -11.6, sz * 0.8]);
    }
    this.mRopes = renderer.createMesh(...spreadLines(ropePts, [0.25, 0.22, 0.20]));

    // 高压线: 杆塔 + 导线
    const wirePts: Vec3[] = [];
    for (const seg of venue.powerLines) {
      const dx = seg.bx - seg.ax, dz = seg.bz - seg.az;
      const len = Math.hypot(dx, dz);
      const n = Math.max(2, Math.round(len / 90));
      const px = -dz / len, pz = dx / len; // 垂直方向
      const tops: Vec3[] = [];
      const span: { x: number; z: number; top: number }[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = seg.ax + dx * t, z = seg.az + dz * t;
        const top = venue.heightAt(x, z) + seg.height;
        tops.push([x, top, z]);
        span.push({ x, z, top });
        this.poleTops.push({ x, z, top });
      }
      this.wireSpans.push(span);
      for (let i = 0; i + 1 < tops.length; i++) {
        for (const off of [-2.6, 2.6]) {
          const SEG = 14;
          for (let j = 0; j < SEG; j++) {
            const t0 = j / SEG, t1 = (j + 1) / SEG;
            const sag = (t: number) => -3.2 * 4 * t * (1 - t);
            wirePts.push([
              tops[i][0] + (tops[i + 1][0] - tops[i][0]) * t0 + px * off,
              tops[i][1] + (tops[i + 1][1] - tops[i][1]) * t0 + sag(t0),
              tops[i][2] + (tops[i + 1][2] - tops[i][2]) * t0 + pz * off,
            ]);
            wirePts.push([
              tops[i][0] + (tops[i + 1][0] - tops[i][0]) * t1 + px * off,
              tops[i][1] + (tops[i + 1][1] - tops[i][1]) * t1 + sag(t1),
              tops[i][2] + (tops[i + 1][2] - tops[i][2]) * t1 + pz * off,
            ]);
          }
        }
      }
    }
    this.mWires = renderer.createMesh(...spreadLines(wirePts, [0.15, 0.15, 0.17]));

    this.bindInput();
    this.showMsg('按住 ↑ 点火加热, 气球会慢慢升空 —— 先用 P 放测风气球探风, 按 T 查看风廓线', 10);
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (this.destroyed) return;
      const dtReal = Math.min(0.1, (t - this.lastT) / 1000);
      this.lastT = t;
      if (!this.end && !this.windPageOpen) this.update(dtReal);
      this.render();
      this.updateHud();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  // ---------------- 输入 ----------------

  private keys = new Set<string>();

  private onKeyDown = (e: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.key);
    if (this.end) return;
    const k = e.key.toLowerCase();
    if (k === 'p') this.dropPibal();
    if (k === ' ') this.dropMarker();
    if (k === 't') this.toggleWindPage();
    if (k === '1') this.timeScale = 1;
    if (k === '2') this.timeScale = 4;
    if (k === '3') this.timeScale = 8;
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key);

  private bindInput(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    const cv = this.renderer.canvas;
    let dragging = false, lx = 0, ly = 0;
    cv.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => (dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.camYaw -= (e.clientX - lx) * 0.006;
      this.camPitch = clamp(this.camPitch + (e.clientY - ly) * 0.004, -0.1, 1.2);
      lx = e.clientX; ly = e.clientY;
    });
    cv.addEventListener('wheel', (e) => {
      this.camDist = clamp(this.camDist * (1 + Math.sign(e.deltaY) * 0.12), 25, 260);
    });
    // HUD 按钮
    const hold = (id: string, key: string) => {
      const el = document.getElementById(id)!;
      el.addEventListener('pointerdown', () => this.keys.add(key));
      el.addEventListener('pointerup', () => this.keys.delete(key));
      el.addEventListener('pointerleave', () => this.keys.delete(key));
    };
    hold('btn-burn', 'ArrowUp');
    hold('btn-vent', 'ArrowDown');
    document.getElementById('btn-pibal')!.addEventListener('click', () => !this.end && this.dropPibal());
    document.getElementById('btn-drop')!.addEventListener('click', () => !this.end && this.dropMarker());
    document.getElementById('btn-wind')!.addEventListener('click', () => !this.end && this.toggleWindPage());
    document.getElementById('btn-wind-close')!.addEventListener('click', () => this.toggleWindPage());
    for (const [id, s] of [['btn-t1', 1], ['btn-t2', 4], ['btn-t3', 8]] as const) {
      document.getElementById(id)!.addEventListener('click', () => (this.timeScale = s));
    }
  }

  private dropPibal(): void {
    if (this.pibalsLeft <= 0) { this.showMsg('测风气球已用完', 3); return; }
    this.pibalsLeft--;
    const b = this.balloon;
    this.pibals.push(new Pibal(b.x, b.z, b.alt));
    this.showMsg(`测风气球已释放 (剩 ${this.pibalsLeft}), 打开风廓线页(T)观察探测进度`, 5);
  }

  private dropMarker(): void {
    const b = this.balloon;
    const ground = this.venue.heightAt(b.x, b.z);
    if (b.alt <= ground + BASKET_DROP + 2) { this.showMsg('还未升空, 无法投袋', 3); return; }
    if (this.markersLeft <= 0) { this.showMsg('标志袋已用完', 3); return; }
    this.markersLeft--;
    this.markers.push(new Marker(b.x, b.z, b.alt - BASKET_DROP, b.vx, b.vz));
    this.showMsg(`标志袋已投下 (剩 ${this.markersLeft})`, 4);
  }

  toggleWindPage(): void {
    this.windPageOpen = !this.windPageOpen;
    document.getElementById('screen-wind')!.classList.toggle('visible', this.windPageOpen);
    if (this.windPageOpen) this.renderWindPage();
  }

  private renderWindPage(): void {
    const b = this.balloon;
    const dx = this.venue.target.x - b.x, dz = this.venue.target.z - b.z;
    drawWindPage(document.getElementById('wind-canvas') as HTMLCanvasElement, {
      venue: this.venue,
      wind: this.wind,
      pibals: this.pibals,
      balloonAlt: b.alt,
      measuredUpTo: this.measuredUpTo,
      balloonLayers: this.balloonLayers,
      targetBearingDeg: vecToBearing(dx, dz),
      targetDistM: Math.hypot(dx, dz),
      groundAlt: this.venue.heightAt(b.x, b.z),
    });
  }

  private showMsg(text: string, sec: number): void {
    const el = document.getElementById('hud-msg')!;
    el.textContent = text;
    el.classList.add('on');
    this.msgTimer = sec;
  }

  // ---------------- 主循环 ----------------

  private update(dtReal: number): void {
    let simDt = dtReal * this.timeScale;
    // 剩余时间不足时按实际剩余截断
    simDt = Math.min(simDt, this.venue.timeLimitSec - this.timeSec);
    const b = this.balloon;
    b.burnerOn = this.keys.has('ArrowUp') && b.fuelKg > 0;
    b.ventOpen = this.keys.has('ArrowDown');
    if (this.keys.has('ArrowLeft')) this.camYaw += 1.4 * dtReal;
    if (this.keys.has('ArrowRight')) this.camYaw -= 1.4 * dtReal;

    while (simDt > 1e-9 && !this.end) {
      const dt = Math.min(0.05, simDt);
      simDt -= dt;
      this.timeSec += dt;
      const w = this.wind.sample(b.alt, this.timeSec);
      b.update(dt, sampleEnv(this.atmo, b.alt), w.x, w.z);
      this.balloonLayers.add(Math.round(b.alt / 100));

      // 测风气球
      for (const p of this.pibals) {
        p.update(dt, this.wind, this.timeSec, PIBAL_CEILING);
        if (p.maxAlt > this.measuredUpTo) this.measuredUpTo = p.maxAlt;
      }
      // 标志袋
      for (const m of this.markers) {
        const wasLanded = m.landed;
        m.update(dt, this.wind, this.timeSec, (x, z) => this.venue.heightAt(x, z));
        if (!wasLanded && m.landed) {
          const d = Math.hypot(m.landX - this.venue.target.x, m.landZ - this.venue.target.z);
          this.showMsg(`标志袋落地: 距目标 ${d.toFixed(1)} m → ${scoreOf(d)} 分`, 8);
        }
      }

      // 地面接触
      const ground = this.venue.heightAt(b.x, b.z);
      if (b.alt < ground + BASKET_DROP) {
        b.alt = ground + BASKET_DROP;
        if (b.vy < 0) b.vy = 0;
        if (this.hasFlown) {
          this.end = 'landed';
        }
      }
      if (b.alt > ground + 40) this.hasFlown = true;
      if (b.alt > this.maxAlt) this.maxAlt = b.alt;

      // 高压线碰撞
      for (const span of this.wireSpans) {
        for (let i = 0; i + 1 < span.length; i++) {
          const a = span[i], c = span[i + 1];
          const dx = c.x - a.x, dz = c.z - a.z;
          const len2 = dx * dx + dz * dz;
          let t = len2 > 0 ? ((b.x - a.x) * dx + (b.z - a.z) * dz) / len2 : 0;
          t = clamp(t, 0, 1);
          const px = a.x + dx * t, pz = a.z + dz * t;
          const wireTop = a.top + (c.top - a.top) * t;
          const hd = Math.hypot(b.x - px, b.z - pz);
          if (hd < 12 && b.alt - BASKET_DROP < wireTop + 2 && b.alt + ENVELOPE_TOP > wireTop - 2) {
            this.end = 'wire';
          }
        }
      }

      // 出界
      const h = this.venue.halfSize * 1.12;
      if (Math.abs(b.x) > h || Math.abs(b.z) > h) this.end = 'oob';
    }
    // 超时(放在子步循环外, 剩余时间不足截断后也能触发)
    if (!this.end && this.timeSec >= this.venue.timeLimitSec) this.end = 'timeout';

    // 燃料警告
    if (b.fuelKg <= 0 && this.msgTimer <= 0 && !this.end) {
      this.showMsg('燃料耗尽! 球内空气正在冷却, 准备迫降', 6);
      this.msgTimer = 6;
    }
    if (this.msgTimer > 0) {
      this.msgTimer -= dtReal;
      if (this.msgTimer <= 0) document.getElementById('hud-msg')!.classList.remove('on');
    }

    if (this.end) this.finish();
  }

  private score(): { score: number; drops: { dist: number; score: number }[] } {
    const drops = this.markers.filter((m) => m.landed).map((m) => {
      const dist = Math.hypot(m.landX - this.venue.target.x, m.landZ - this.venue.target.z);
      return { dist, score: scoreOf(dist) };
    });
    return { score: drops.length ? Math.max(...drops.map((d) => d.score)) : 0, drops };
  }

  private finish(): void {
    const { score, drops } = this.score();
    const b = this.balloon;
    const statusMap: Record<string, [string, string]> = {
      wire: ['出局 — 触碰高压线', '气球挂上了高压输电线, 比赛终止。进近目标前注意观察线路走向, 保持安全高度。'],
      landed: ['比赛结束 — 已着陆', drops.length ? '飞行完成, 成绩如下。' : '着陆前没有投下标志袋, 无成绩。'],
      timeout: ['比赛结束 — 时间到', drops.length ? '规定时间用完, 按已投标志袋计分。' : '时间用完仍未投袋, 无成绩。'],
      oob: ['比赛结束 — 飞出赛区', '飞出了赛区边界, 按已投标志袋计分。'],
    };
    const [st, detail] = statusMap[this.end!] ?? ['结束', ''];
    fillResults({
      status: st,
      statusDetail: detail,
      score: this.end === 'wire' ? 0 : score,
      drops: this.end === 'wire' ? [] : drops,
      flightTimeSec: this.timeSec,
      fuelUsedKg: this.fuelStart - b.fuelKg,
      fuelStartKg: this.fuelStart,
      maxAltM: this.maxAlt,
      burnSec: b.burnSeconds,
    });
    showScreen('screen-results');
    document.getElementById('btn-again')!.onclick = () => {
      this.destroy();
      showScreen(null);
      new FlightGame(this.venue, this.renderer, this.onExit);
    };
    document.getElementById('btn-venues')!.onclick = () => {
      this.destroy();
      this.onExit();
    };
  }

  // ---------------- 渲染 ----------------

  private render(): void {
    const r = this.renderer;
    const b = this.balloon;
    const eye: Vec3 = [
      b.x + this.camDist * Math.cos(this.camPitch) * Math.sin(this.camYaw),
      b.alt + this.camDist * Math.sin(this.camPitch),
      b.z + this.camDist * Math.cos(this.camPitch) * Math.cos(this.camYaw),
    ];
    // 相机不入地
    const minY = this.venue.heightAt(eye[0], eye[2]) + 3;
    if (eye[1] < minY) eye[1] = minY;
    r.begin(eye, [b.x, b.alt + 4, b.z]);

    const half = this.venue.halfSize;
    r.draw(this.mTerrain, mat4TranslateScale(0, 0, 0, 1, 1, 1));
    if (this.mWater && this.venue.waterLevel !== null) {
      r.draw(this.mWater, mat4TranslateScale(0, this.venue.waterLevel - 0.5, 0, half * 2.2, 1, half * 2.2), 0.06);
    }
    r.draw(this.mTarget, mat4TranslateScale(0, 0, 0, 1, 1, 1), 0.12);
    // 目标中心旗杆
    const tg = this.venue.heightAt(this.venue.target.x, this.venue.target.z);
    r.draw(this.mPole, mat4TranslateScale(this.venue.target.x, tg + 3, this.venue.target.z, 0.4, 6, 0.4));
    r.draw(this.mFlag, mat4TranslateScale(this.venue.target.x + 0.9, tg + 5.4, this.venue.target.z, 1.8, 1.0, 0.1), 0.2);
    // 高压线杆塔与导线
    for (const p of this.poleTops) {
      const gh = this.venue.heightAt(p.x, p.z);
      r.draw(this.mPole, mat4TranslateScale(p.x, (gh + p.top) / 2, p.z, 0.7, p.top - gh, 0.7));
    }
    r.draw(this.mWires, mat4TranslateScale(0, 0, 0, 1, 1, 1));
    // 测风气球
    for (const p of this.pibals) {
      if (!p.active) continue;
      r.draw(this.mPibal, mat4TranslateScale(p.x, p.alt, p.z, 1.0, 1.15, 1.0), 0.15);
    }
    // 标志袋
    for (const m of this.markers) {
      r.draw(this.mMarker, mat4TranslateScale(m.x, m.alt, m.z, 0.35, 0.5, 0.35), 0.1);
    }
    // 气球
    r.draw(this.mEnvelope, mat4TranslateScale(b.x, b.alt, b.z, 8.75, 9.8, 8.75));
    r.draw(this.mBasket, mat4TranslateScale(b.x, b.alt - 12.2, b.z, 1.6, 1.3, 1.6));
    r.draw(this.mRopes, mat4TranslateScale(b.x, b.alt, b.z, 1, 1, 1));
    if (b.burnerOn && b.fuelKg > 0) {
      r.draw(this.mFlame, mat4TranslateScale(b.x, b.alt - 9.4, b.z, 1.1, 2.2, 1.1), 1.6);
    }
  }

  private updateHud(): void {
    const $ = (id: string) => document.getElementById(id)!;
    const b = this.balloon;
    const ground = this.venue.heightAt(b.x, b.z);
    const w = this.wind.sample(b.alt, this.timeSec);
    const dx = this.venue.target.x - b.x, dz = this.venue.target.z - b.z;
    const dist = Math.hypot(dx, dz);
    $('hud-alt').textContent = `${Math.round(b.alt)} m (离地 ${Math.max(0, Math.round(b.alt - ground))} m)`;
    $('hud-vario').textContent = `${b.vy >= 0 ? '+' : ''}${b.vy.toFixed(1)} m/s`;
    $('hud-vario').style.color = b.vy > 0.3 ? '#7dff8a' : b.vy < -0.3 ? '#ff8a7d' : '#e8eef7';
    const tC = b.tempK - 273.15;
    $('hud-temp').textContent = `${tC.toFixed(0)} ℃`;
    ($('hud-tempbar') as HTMLElement).style.width = `${clamp((tC / 120) * 100, 0, 100)}%`;
    ($('hud-tempbar') as HTMLElement).style.background = tC > 105 ? '#ff5f5f' : tC > 80 ? '#ffb35f' : '#5fd0ff';
    $('hud-fuel').textContent = `${b.fuelKg.toFixed(1)} kg`;
    ($('hud-fuelbar') as HTMLElement).style.width = `${(b.fuelKg / this.fuelStart) * 100}%`;
    $('hud-wind').textContent = `${dirName(w.dirFromDeg)}风 ${w.speed.toFixed(1)} m/s`;
    $('hud-dist').textContent = `${(dist / 1000).toFixed(2)} km · ${dirName(vecToBearing(dx, dz))}方`;
    $('hud-time').textContent = fmtTime(this.venue.timeLimitSec - this.timeSec);
    $('hud-time').style.color = this.venue.timeLimitSec - this.timeSec < 180 ? '#ff8a7d' : '#e8eef7';
    $('hud-pibal').textContent = `测风球 ×${this.pibalsLeft}`;
    $('hud-marker').textContent = `标志袋 ×${this.markersLeft}`;
    $('hud-speed').textContent = `×${this.timeScale}`;
    // 目标方位指示箭头(相对相机朝向)
    const rel = vecToBearing(dx, dz) - ((-this.camYaw * 180) / Math.PI);
    ($('hud-target-arrow') as HTMLElement).style.transform = `rotate(${rel}deg)`;
    $('hud-burn-state').textContent = b.burnerOn && b.fuelKg > 0 ? '🔥 燃烧中' : b.ventOpen ? '🕳 放气中' : '— 飘浮 —';
    if (this.windPageOpen) this.renderWindPage();
  }
}

function spread(m: { pos: number[]; norm: number[]; col: number[]; idx: number[] }):
  [number[], number[], number[], number[]] {
  return [m.pos, m.norm, m.col, m.idx];
}
function spreadLines(pts: Vec3[], color: Vec3): [number[], number[], number[], number[], number] {
  const m = polylineToLines(pts, color);
  return [m.pos, m.norm, m.col, m.idx, 1]; // 1 = gl.LINES
}

/** 计分: 距目标越近分越高 */
export function scoreOf(distM: number): number {
  return Math.round(1000 * Math.exp(-distM / 75));
}
