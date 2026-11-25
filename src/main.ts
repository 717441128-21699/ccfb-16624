// 入口: 赛区选择 -> 飞行 -> 成绩

import { VENUES } from './venues';
import { Renderer } from './renderer';
import { FlightGame } from './game';
import { showScreen } from './ui';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

let game: FlightGame | null = null;

function showVenueSelect(): void {
  game = null;
  showScreen('screen-venue');
}

function startFlight(venueId: string): FlightGame {
  const venue = VENUES.find((v) => v.id === venueId)!;
  showScreen(null);
  document.getElementById('hud')!.classList.add('visible');
  game = new FlightGame(venue, renderer, () => {
    document.getElementById('hud')!.classList.remove('visible');
    showVenueSelect();
  });
  return game;
}

// 构建赛区卡片
const list = document.getElementById('venue-list')!;
for (const v of VENUES) {
  const card = document.createElement('div');
  card.className = 'venue-card';
  card.innerHTML = `
    <h2>${v.name}</h2>
    <div class="diff">${v.difficulty}</div>
    <p>${v.desc}</p>
    <div class="meta">
      <span>时限 ${Math.round(v.timeLimitSec / 60)} 分钟</span>
      <span>燃料 ${v.fuelKg} kg</span>
      <span>测风球 ×${v.pibalCount}</span>
      <span>标志袋 ×${v.markerCount}</span>
    </div>
    <button>进入赛区 →</button>
  `;
  card.querySelector('button')!.addEventListener('click', () => startFlight(v.id));
  list.appendChild(card);
}

showVenueSelect();

// 支持 ?venue=valley|hills|lake 直接进入赛区(便于测试/分享)
const params = new URLSearchParams(location.search);
const q = params.get('venue');
if (q && VENUES.some((v) => v.id === q)) {
  const g = startFlight(q);
  if (params.get('wind')) g.toggleWindPage();
}
