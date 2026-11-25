// UI: 页面切换 / 风廓线分析页绘制 / 成绩页

import { Venue } from './venues';
import { WindProfile } from './wind';
import { Pibal } from './entities';
import { clamp } from './math';

const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

/** 方位角(度) -> 中文方位名 */
export function dirName(deg: number): string {
  return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function showScreen(id: string | null): void {
  for (const el of document.querySelectorAll<HTMLElement>('.screen')) {
    el.classList.toggle('visible', el.id === id);
  }
}

export interface WindPageData {
  venue: Venue;
  wind: WindProfile;
  pibals: Pibal[];
  balloonAlt: number;
  measuredUpTo: number;   // 测风气球探测到的最高高度
  balloonLayers: Set<number>; // 气球亲自测过的层(100m 一层)
  targetBearingDeg: number;
  targetDistM: number;
  groundAlt: number;
}

/** 绘制风廓线分析页 */
export function drawWindPage(cv: HTMLCanvasElement, d: WindPageData): void {
  const ctx = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0e1520';
  ctx.fillRect(0, 0, W, H);

  const topAlt = 1600;
  const plotL = 70, plotR = W - 250, plotT = 46, plotB = H - 40;
  const altToY = (a: number) => plotB - (a / topAlt) * (plotB - plotT);
  const cx = (plotL + plotR) / 2;

  // 标题
  ctx.fillStyle = '#e8eef7';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText(`${d.venue.name} · 风廓线分析`, plotL, 26);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#8fa3bd';
  ctx.fillText('测风气球探测高度: ' + Math.round(d.measuredUpTo) + ' m   (未探测层的风未知)', plotL + 260, 26);

  // 逆温层阴影
  const inv = d.venue.inversion;
  ctx.fillStyle = 'rgba(255,150,60,0.13)';
  ctx.fillRect(plotL, altToY(inv.top), plotR - plotL, altToY(inv.base) - altToY(inv.top));
  ctx.fillStyle = '#d99a55';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`逆温层 ${inv.base}–${inv.top} m (ΔT +${inv.strength}K)`, plotL + 6, altToY(inv.top) + 13);

  // 高度网格 + 每层风
  ctx.textBaseline = 'middle';
  for (let alt = 0; alt <= topAlt; alt += 100) {
    const y = altToY(alt);
    ctx.strokeStyle = 'rgba(120,140,170,0.18)';
    ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
    ctx.fillStyle = '#7d90ac';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${alt} m`, plotL - 8, y);
    ctx.textAlign = 'left';

    const measured = alt <= d.measuredUpTo || d.balloonLayers.has(Math.round(alt / 100));
    if (alt === 0) continue;
    if (measured) {
      const w = d.wind.meanAt(alt);
      const toRad = ((d.wind.meanAt(alt).dirFromDeg + 180) * Math.PI) / 180;
      const len = 14 + w.speed * 6;
      const dx = Math.sin(toRad) * len, dy = -Math.cos(toRad) * len;
      ctx.strokeStyle = '#5fd0ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx - dx / 2, y + dy / 2); ctx.lineTo(cx + dx / 2, y - dy / 2); ctx.stroke();
      // 箭头头部
      const ah = 7;
      const ux = dx / len, uy = dy / len;
      ctx.beginPath();
      ctx.moveTo(cx + dx / 2, y - dy / 2);
      ctx.lineTo(cx + dx / 2 - ux * ah - uy * ah * 0.6, y - dy / 2 - uy * ah + ux * ah * 0.6);
      ctx.moveTo(cx + dx / 2, y - dy / 2);
      ctx.lineTo(cx + dx / 2 - ux * ah + uy * ah * 0.6, y - dy / 2 - uy * ah - ux * ah * 0.6);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#cfe3f7';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(`${dirName(w.dirFromDeg)}风 ${w.speed.toFixed(1)} m/s`, cx + 70, y);
    } else {
      ctx.fillStyle = '#4a5a72';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('— 未探测 —', cx - 34, y);
    }
  }

  // 地面参考
  const gy = altToY(clamp(d.groundAlt, 0, topAlt));
  ctx.strokeStyle = '#6fae5f';
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(plotL, gy); ctx.lineTo(plotR, gy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#6fae5f';
  ctx.fillText('地面', plotL + 4, gy - 9);

  // 当前气球高度
  const by = altToY(clamp(d.balloonAlt, 0, topAlt));
  ctx.strokeStyle = '#ff5f5f';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(plotL, by); ctx.lineTo(plotR, by); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = '#ff5f5f';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText(`▶ 气球 ${Math.round(d.balloonAlt)} m`, plotR - 92, by - 9);

  // 右侧面板: 目标方位
  const px = plotR + 24;
  ctx.fillStyle = '#e8eef7';
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillText('目标区', px, plotT + 6);
  // 罗盘
  const ccx = px + 78, ccy = plotT + 78, cr = 52;
  ctx.strokeStyle = '#51637e';
  ctx.beginPath(); ctx.arc(ccx, ccy, cr, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#8fa3bd';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('北', ccx - 6, ccy - cr - 2);
  const br = (d.targetBearingDeg * Math.PI) / 180;
  const bx = Math.sin(br) * (cr - 8), bz = -Math.cos(br) * (cr - 8);
  ctx.strokeStyle = '#ffd75f';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(ccx, ccy); ctx.lineTo(ccx + bx, ccy + bz); ctx.stroke();
  ctx.beginPath(); ctx.arc(ccx + bx, ccy + bz, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd75f'; ctx.fill();
  ctx.lineWidth = 1;
  ctx.fillStyle = '#cfe3f7';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(`方位 ${dirName(d.targetBearingDeg)} ${Math.round(d.targetBearingDeg)}°`, px, ccy + cr + 22);
  ctx.fillText(`距离 ${(d.targetDistM / 1000).toFixed(2)} km`, px, ccy + cr + 42);

  // 操作提示
  ctx.fillStyle = '#8fa3bd';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('按 T 或点击右上角按钮返回飞行 · 分析页打开时比赛计时暂停', plotL, H - 14);
}

export interface ResultsData {
  status: string;
  statusDetail: string;
  score: number;
  drops: { dist: number; score: number }[];
  flightTimeSec: number;
  fuelUsedKg: number;
  fuelStartKg: number;
  maxAltM: number;
  burnSec: number;
}

export function fillResults(d: ResultsData): void {
  const $ = (id: string) => document.getElementById(id)!;
  $('res-status').textContent = d.status;
  $('res-detail').textContent = d.statusDetail;
  $('res-score').textContent = String(d.score);
  const rows: [string, string][] = [
    ['标志袋成绩', d.drops.length
      ? d.drops.map((x, i) => `#${i + 1}: 距目标 ${x.dist.toFixed(1)} m → ${x.score} 分`).join('　')
      : '未投袋'],
    ['飞行时间', `${Math.floor(d.flightTimeSec / 60)} 分 ${Math.round(d.flightTimeSec % 60)} 秒`],
    ['燃料消耗', `${d.fuelUsedKg.toFixed(1)} / ${d.fuelStartKg} kg (开火 ${Math.round(d.burnSec)} s)`],
    ['最大高度', `${Math.round(d.maxAltM)} m`],
  ];
  $('res-rows').innerHTML = rows
    .map(([k, v]) => `<div class="res-row"><span>${k}</span><span>${v}</span></div>`)
    .join('');
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
