// 赛区数据健全性检查: 起飞场/目标不能在水里, 目标在时限内理论上可达
import { VENUES } from '../src/venues';
import { WindProfile } from '../src/wind';

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
};

for (const v of VENUES) {
  const hl = v.heightAt(v.launch.x, v.launch.z);
  const ht = v.heightAt(v.target.x, v.target.z);
  if (v.waterLevel !== null) {
    ok(hl > v.waterLevel + 1, `${v.name}: 起飞场在地面 (${hl.toFixed(1)} m > 水面 ${v.waterLevel} m)`);
    ok(ht > v.waterLevel + 1, `${v.name}: 目标区在地面 (${ht.toFixed(1)} m > 水面 ${v.waterLevel} m)`);
  }
  const dist = Math.hypot(v.target.x - v.launch.x, v.target.z - v.launch.z);
  const wind = new WindProfile(v.wind);
  const maxWind = Math.max(...v.wind.map((w) => w.speed));
  const reachable = dist / maxWind < v.timeLimitSec * 0.8;
  ok(reachable, `${v.name}: 目标距离 ${(dist / 1000).toFixed(1)} km, 最大风 ${maxWind} m/s, 时限 ${v.timeLimitSec / 60} min → 可达`);
  const inBounds = Math.abs(v.target.x) < v.halfSize && Math.abs(v.target.z) < v.halfSize &&
    Math.abs(v.launch.x) < v.halfSize && Math.abs(v.launch.z) < v.halfSize;
  ok(inBounds, `${v.name}: 起飞场/目标在赛区边界内`);
  // 清晨风廓线: 高层风应大于地面风
  ok(wind.meanAt(1200).speed > wind.meanAt(50).speed, `${v.name}: 清晨廓线(地面 ${wind.meanAt(50).speed.toFixed(1)} < 1200m ${wind.meanAt(1200).speed.toFixed(1)} m/s)`);
}

console.log(failures === 0 ? '\n赛区检查全部通过 ✓' : `\n${failures} 项未通过 ✗`);
process.exit(failures === 0 ? 0 : 1);
