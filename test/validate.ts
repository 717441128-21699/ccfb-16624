// 物理模型验证: 对照热气球飞行手册经验值 (允许误差 ±15%)
// 运行: npm run validate

import { Atmosphere, G0, R_AIR } from '../src/atmosphere';
import { Balloon, DEFAULT_BALLOON, sampleEnv } from '../src/balloon';

let failures = 0;

function check(name: string, actual: number, expected: number, tolPct: number, unit: string): void {
  const err = Math.abs(actual - expected) / expected;
  const ok = err <= tolPct / 100;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}: 模拟 ${actual.toFixed(2)} ${unit} | ` +
    `手册经验值 ${expected} ${unit} | 偏差 ${(err * 100).toFixed(1)}% (允许 ±${tolPct}%)`,
  );
}

const atmo = new Atmosphere({ seaLevelTempC: 15, lapseRate: 0.0065 });
const ALT = 300;
const env = sampleEnv(atmo, ALT);

// ---- A1: 理想气体定律 ----
// 球内密度必须严格满足 rho = p/(R·T), 且温度越高密度越低、升力越大
{
  const b = new Balloon(DEFAULT_BALLOON, 60);
  b.tempK = 360;
  const rhoIn = b.airMass(env.pressure) / DEFAULT_BALLOON.volume;
  const rhoIdeal = env.pressure / (R_AIR * b.tempK);
  const relErr = Math.abs(rhoIn - rhoIdeal) / rhoIdeal;
  const b2 = new Balloon(DEFAULT_BALLOON, 60);
  b2.tempK = 380;
  const monotonic = b2.netLiftN(env) > b.netLiftN(env);
  const ok = relErr < 1e-9 && monotonic;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  A1 理想气体定律: rho_in = p/(R·T) 严格成立, 升温→升力增大 (相对误差 ${relErr.toExponential(1)})`);
}

// 悬浮温度(中性浮力)
function neutralBalloon(): Balloon {
  const b = new Balloon(DEFAULT_BALLOON, 60);
  b.alt = ALT;
  b.tempK = b.neutralTempK(env);
  return b;
}

// ---- A2: 持续燃烧后的稳定爬升率 ----
// 手册经验值: AX-7/8 级气球最大持续爬升率 ≈ 1000 fpm (5.08 m/s)
{
  const b = neutralBalloon();
  b.burnerOn = true;
  let t = 0;
  const dt = 0.05;
  let alt0 = 0, t0 = 0;
  while (t < 180) {
    b.update(dt, sampleEnv(atmo, b.alt), 0, 0);
    t += dt;
    if (t >= 60 && t0 === 0) { alt0 = b.alt; t0 = t; }
  }
  const climb = (b.alt - alt0) / (t - t0);
  check('A2 持续燃烧稳定爬升率', climb, 5.08, 15, 'm/s');
}

// ---- A3: 燃烧器响应滞后 ----
// 手册经验: 点火后需数秒至十几秒才建立明显爬升 (热惯性)
{
  const b = neutralBalloon();
  b.burnerOn = true;
  let t = 0;
  const dt = 0.05;
  let tRise = -1;
  while (t < 60) {
    b.update(dt, sampleEnv(atmo, b.alt), 0, 0);
    t += dt;
    if (b.vy > 1.0 && tRise < 0) tRise = t;
  }
  const ok = tRise > 3 && tRise < 30;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  A3 燃烧器响应滞后: 点火后 ${tRise.toFixed(1)} s 建立 1 m/s 爬升 (经验: 数秒~30秒内, 体现热惯性)`);
}

// ---- A4: 续航时间 ----
// 手册经验值: 60 kg 丙烷(3×20kg 钢瓶) 正常飞行续航 ≈ 1.75 h (典型范围 1.5–2 h)
{
  const b = neutralBalloon();
  const dt = 0.1;
  let t = 0;
  let burnStart = 0;
  // 砰砰控制保持高度: 下降超过 0.5 m/s 点火, 上升超过 0.5 m/s 停火
  while (b.fuelKg > 0 && t < 6 * 3600) {
    b.burnerOn = b.vy < -0.5 && b.tempK < DEFAULT_BALLOON.maxTempC + 273.15 - 2;
    if (b.vy > 0.5) b.burnerOn = false;
    b.update(dt, sampleEnv(atmo, b.alt), 0, 0);
    t += dt;
  }
  const hours = t / 3600;
  const duty = (b.burnSeconds / t) * 100;
  console.log(`     (燃烧占空比 ${duty.toFixed(0)}%, 平均消耗 ${((60 / t) * 3600).toFixed(1)} kg/h)`);
  check('A4 60 kg 丙烷续航', hours, 1.75, 15, '小时');
}

// ---- A5: 丙烷消耗与开火总时长成正比 ----
{
  const run = (burnSec: number) => {
    const b = neutralBalloon();
    b.burnerOn = true;
    const dt = 0.05;
    const steps = Math.round(burnSec / dt);
    for (let i = 0; i < steps; i++) b.update(dt, sampleEnv(atmo, b.alt), 0, 0);
    return 60 - b.fuelKg;
  };
  const c30 = run(30), c90 = run(90);
  const ratio = c90 / c30;
  const ok = Math.abs(ratio - 3) < 1e-6;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  A5 丙烷消耗 ∝ 开火时长: 90s/30s 消耗比 = ${ratio.toFixed(4)} (严格线性)`);
}

// ---- A6: 停火冷却下降 ----
// 手册经验: 停火后球内空气缓慢冷却, 约 1–2 分钟内转入下降
{
  const b = neutralBalloon();
  b.burnerOn = false;
  const dt = 0.05;
  let t = 0;
  let tDescend = -1;
  while (t < 300) {
    b.update(dt, sampleEnv(atmo, b.alt), 0, 0);
    t += dt;
    if (b.vy < -0.5 && tDescend < 0) tDescend = t;
  }
  const ok = tDescend > 20 && tDescend < 180;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  A6 停火冷却: ${tDescend.toFixed(0)} s 后转入 0.5 m/s 下降 (经验: 1–2 分钟内)`);
}

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项未通过 ✗`);
process.exit(failures === 0 ? 0 : 1);
