// ===== ARENA SIMULATION =====
const canvas = document.getElementById('arenaCanvas');
const ctx = canvas.getContext('2d');

// Canvas size
const W = canvas.width;
const H = canvas.height;

// Arena layout (fraction of canvas)
const WALL = 18;
const ARENA_X = WALL, ARENA_Y = WALL;
const ARENA_W = W - WALL * 2, ARENA_H = H - WALL * 2;

// Trap zones (x,y,w,h in arena fraction)
const TRAPS = [
  { x: 0.22, y: 0.14, w: 0.18, h: 0.18, label: 'Bẫy nhỏ' },
  { x: 0.60, y: 0.68, w: 0.18, h: 0.18, label: 'Bẫy nhỏ' },
];

// Trap doors (x,y,w,h)
const TRAPDOORS = [
  { x: 0.02, y: 0.37, w: 0.14, h: 0.26, label: 'Cửa sập' },
  { x: 0.84, y: 0.37, w: 0.14, h: 0.26, label: 'Cửa sập' },
];

// Start positions
const START_BLUE = { x: 0.5, y: 0.08 };
const START_RED  = { x: 0.5, y: 0.88 };

const ROBOT_R = 22;
const SPEED = 3.5;

let gameState = 'idle'; // idle, running, over
let timeLeft = 180;
let ticker = null;
let trapTicker = null;
let keys = {};

let blue = makeRobot(START_BLUE, '#00c8ff', '#0050cc', 'BLUE');
let red  = makeRobot(START_RED,  '#ff3030', '#990000', 'RED');

let scoreBlue = 100, scoreRed = 100;

let logEntries = [];

// AI state
let aiTarget = null;
let aiMode = 'chase'; // chase, evade, roam
let aiTimer = 0;

function makeRobot(startFrac, color, colorDark, name) {
  return {
    x: ARENA_X + startFrac.x * ARENA_W,
    y: ARENA_Y + startFrac.y * ARENA_H,
    vx: 0, vy: 0,
    color, colorDark, name,
    alive: true,
    inTrap: false,
    trapTime: 0,
    angle: name === 'BLUE' ? Math.PI : 0,
    pulse: 0,
    startFrac
  };
}

function resetGame() {
  clearInterval(ticker);
  clearInterval(trapTicker);
  ticker = null; trapTicker = null;
  gameState = 'idle';
  timeLeft = 180;
  scoreBlue = 100; scoreRed = 100;
  blue = makeRobot(START_BLUE, '#00c8ff', '#0050cc', 'BLUE');
  red  = makeRobot(START_RED,  '#ff3030', '#990000', 'RED');
  aiMode = 'chase'; aiTimer = 0;
  logEntries = [];
  keys = {};
  updateHUD();
  clearLog();
  addLog('Hệ thống sẵn sàng. Nhấn START để bắt đầu trận đấu.', 'highlight');
  document.getElementById('matchStatus').textContent = 'Nhấn START để bắt đầu';
  draw();
}

function startGame() {
  if (gameState === 'running') return;
  gameState = 'running';
  addLog('🚀 Trận đấu bắt đầu! Cả hai robot xuất phát!', 'highlight');
  document.getElementById('matchStatus').textContent = 'Đang thi đấu...';

  ticker = setInterval(() => {
    if (gameState !== 'running') return;
    timeLeft--;
    if (timeLeft <= 0) {
      timeLeft = 0;
      endGame('time');
    }
    updateHUD();
    gameLoop();
  }, 1000);

  // Smooth animation
  requestAnimationFrame(animFrame);
}

let lastAnim = 0;
function animFrame(ts) {
  if (gameState !== 'running') return;
  const dt = Math.min((ts - lastAnim) / 1000, 0.05);
  lastAnim = ts;
  moveRobots(dt);
  draw();
  requestAnimationFrame(animFrame);
}

function gameLoop() {
  checkTrapCollisions();
  checkTrapdoors();
  updateLog();
}

function moveRobots(dt) {
  if (!blue.alive || !red.alive) return;
  blue.pulse = (blue.pulse + dt * 3) % (Math.PI * 2);
  red.pulse  = (red.pulse  + dt * 4) % (Math.PI * 2);

  // Blue: player control
  let bvx = 0, bvy = 0;
  if (keys['ArrowUp']    || keys['w'] || keys['W']) bvy = -1;
  if (keys['ArrowDown']  || keys['s'] || keys['S']) bvy =  1;
  if (keys['ArrowLeft']  || keys['a'] || keys['A']) bvx = -1;
  if (keys['ArrowRight'] || keys['d'] || keys['D']) bvx =  1;

  const blen = Math.sqrt(bvx*bvx + bvy*bvy);
  if (blen > 0) { bvx /= blen; bvy /= blen; blue.angle = Math.atan2(bvy, bvx); }
  blue.x += bvx * SPEED;
  blue.y += bvy * SPEED;
  clampToArena(blue);

  // Red: AI
  aiTimer++;
  if (aiTimer > 120) { aiMode = Math.random() < 0.6 ? 'chase' : 'evade'; aiTimer = 0; }

  let rdx = 0, rdy = 0;
  if (aiMode === 'chase') {
    rdx = blue.x - red.x;
    rdy = blue.y - red.y;
  } else {
    // Evade toward center
    rdx = (ARENA_X + ARENA_W/2) - red.x + (Math.random()-0.5)*80;
    rdy = (ARENA_Y + ARENA_H/2) - red.y + (Math.random()-0.5)*80;
  }

  // Avoid trapdoors
  for (const td of TRAPDOORS) {
    const tx = ARENA_X + td.x * ARENA_W + td.w * ARENA_W / 2;
    const ty = ARENA_Y + td.y * ARENA_H + td.h * ARENA_H / 2;
    const dx = red.x - tx, dy = red.y - ty;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 80) { rdx += dx / dist * 3; rdy += dy / dist * 3; }
  }

  const rlen = Math.sqrt(rdx*rdx + rdy*rdy);
  if (rlen > 0) { rdx /= rlen; rdy /= rlen; red.angle = Math.atan2(rdy, rdx); }
  red.x += rdx * SPEED * 0.85;
  red.y += rdy * SPEED * 0.85;
  clampToArena(red);

  // Collision
  handleCollision(blue, red);
}

function clampToArena(r) {
  r.x = Math.max(ARENA_X + ROBOT_R, Math.min(ARENA_X + ARENA_W - ROBOT_R, r.x));
  r.y = Math.max(ARENA_Y + ROBOT_R, Math.min(ARENA_Y + ARENA_H - ROBOT_R, r.y));
}

function handleCollision(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const minDist = ROBOT_R * 2;
  if (dist < minDist && dist > 0) {
    const nx = dx / dist, ny = dy / dist;
    const overlap = minDist - dist;
    a.x -= nx * overlap * 0.5;
    a.y -= ny * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.y += ny * overlap * 0.5;
  }
}

function checkTrapCollisions() {
  for (const r of [blue, red]) {
    if (!r.alive) continue;
    let inT = false;
    for (const trap of TRAPS) {
      const tx = ARENA_X + trap.x * ARENA_W;
      const ty = ARENA_Y + trap.y * ARENA_H;
      const tw = trap.w * ARENA_W;
      const th = trap.h * ARENA_H;
      if (r.x > tx && r.x < tx+tw && r.y > ty && r.y < ty+th) {
        inT = true;
        if (!r.inTrap) {
          r.inTrap = true;
          addLog(`⚠️ Robot ${r.name} rơi vào BẪY! Đang trừ điểm...`, r.name === 'BLUE' ? 'blue' : 'danger');
        }
      }
    }
    if (!inT && r.inTrap) {
      r.inTrap = false;
      addLog(`✅ Robot ${r.name} thoát khỏi bẫy.`, '');
    }
    if (r.inTrap) {
      if (r.name === 'BLUE') scoreBlue = Math.max(0, scoreBlue - 1);
      else scoreRed = Math.max(0, scoreRed - 1);
      updateHUD();
    }
  }
}

function checkTrapdoors() {
  for (const r of [blue, red]) {
    if (!r.alive) continue;
    for (const td of TRAPDOORS) {
      const tx = ARENA_X + td.x * ARENA_W;
      const ty = ARENA_Y + td.y * ARENA_H;
      const tw = td.w * ARENA_W;
      const th = td.h * ARENA_H;
      if (r.x > tx+ROBOT_R*0.5 && r.x < tx+tw-ROBOT_R*0.5 && r.y > ty+ROBOT_R*0.5 && r.y < ty+th-ROBOT_R*0.5) {
        r.alive = false;
        addLog(`💥 Robot ${r.name} RƠI VÀO CỬA SẬP! Thua ngay lập tức!`, 'danger');
        endGame('trapdoor', r.name);
        return;
      }
    }
  }
}

function endGame(reason, loserName) {
  gameState = 'over';
  clearInterval(ticker);
  clearInterval(trapTicker);

  let msg = '';
  if (reason === 'trapdoor') {
    const winner = loserName === 'BLUE' ? 'ĐỎ' : 'XANH';
    msg = `🏆 ĐỘI ${winner} THẮNG! (Robot đối thủ rơi cửa sập)`;
    document.getElementById('matchStatus').textContent = `ĐỘI ${winner} THẮNG!`;
  } else if (reason === 'time') {
    if (scoreBlue > scoreRed) { msg = '🏆 ĐỘI XANH THẮNG theo điểm số!'; document.getElementById('matchStatus').textContent = 'ĐỘI XANH THẮNG!'; }
    else if (scoreRed > scoreBlue) { msg = '🏆 ĐỘI ĐỎ THẮNG theo điểm số!'; document.getElementById('matchStatus').textContent = 'ĐỘI ĐỎ THẮNG!'; }
    else { msg = '⚖️ HÒA ĐIỂM! Cần hiệp phụ (50đ / 60s)!'; document.getElementById('matchStatus').textContent = 'HÒA — Hiệp phụ!'; }
  }
  addLog(msg, 'highlight');
  addLog(`Kết quả: XANH ${scoreBlue}đ — ĐỎ ${scoreRed}đ`, '');
  draw();
}

function updateLog() {}

function addLog(msg, cls = '') {
  logEntries.unshift({ msg, cls });
  if (logEntries.length > 30) logEntries.pop();
  const el = document.getElementById('logContent');
  el.innerHTML = logEntries.map(e =>
    `<div class="log-entry ${e.cls}">${e.msg}</div>`
  ).join('');
}

function clearLog() {
  logEntries = [];
  document.getElementById('logContent').innerHTML = '';
}

function updateHUD() {
  document.getElementById('scoreBlue').textContent = Math.max(0, scoreBlue);
  document.getElementById('scoreRed').textContent  = Math.max(0, scoreRed);
  document.getElementById('barBlue').style.width = Math.max(0, scoreBlue) + '%';
  document.getElementById('barRed').style.width  = Math.max(0, scoreRed) + '%';

  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  document.getElementById('timer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
}

// ===== DRAW =====
function draw() {
  ctx.clearRect(0, 0, W, H);

  // Arena background
  ctx.fillStyle = '#1e3020';
  ctx.beginPath();
  ctx.roundRect(ARENA_X, ARENA_Y, ARENA_W, ARENA_H, 4);
  ctx.fill();

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const grid = 60;
  for (let x = ARENA_X; x < ARENA_X + ARENA_W; x += grid) {
    ctx.beginPath(); ctx.moveTo(x, ARENA_Y); ctx.lineTo(x, ARENA_Y+ARENA_H); ctx.stroke();
  }
  for (let y = ARENA_Y; y < ARENA_Y + ARENA_H; y += grid) {
    ctx.beginPath(); ctx.moveTo(ARENA_X, y); ctx.lineTo(ARENA_X+ARENA_W, y); ctx.stroke();
  }

  // Trapdoors
  for (const td of TRAPDOORS) {
    const tx = ARENA_X + td.x * ARENA_W;
    const ty = ARENA_Y + td.y * ARENA_H;
    const tw = td.w * ARENA_W;
    const th = td.h * ARENA_H;
    ctx.fillStyle = '#1a0000';
    ctx.fillRect(tx, ty, tw, th);
    ctx.strokeStyle = '#c00';
    ctx.lineWidth = 2;
    ctx.strokeRect(tx, ty, tw, th);
    // Hatch
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(200,0,0,0.3)';
    ctx.lineWidth = 1;
    for (let i = -th; i < tw+th; i += 12) {
      ctx.moveTo(tx + i, ty); ctx.lineTo(tx + i + th, ty + th);
    }
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#ff5252';
    ctx.font = 'bold 11px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CỬA', tx + tw/2, ty + th/2 - 6);
    ctx.fillText('SẬP', tx + tw/2, ty + th/2 + 8);
  }

  // Traps
  for (const trap of TRAPS) {
    const tx = ARENA_X + trap.x * ARENA_W;
    const ty = ARENA_Y + trap.y * ARENA_H;
    const tw = trap.w * ARENA_W;
    const th = trap.h * ARENA_H;
    const grd = ctx.createRadialGradient(tx+tw/2, ty+th/2, 2, tx+tw/2, ty+th/2, Math.max(tw,th));
    grd.addColorStop(0, 'rgba(255,80,0,0.6)');
    grd.addColorStop(1, 'rgba(220,30,0,0.4)');
    ctx.fillStyle = grd;
    ctx.fillRect(tx, ty, tw, th);
    ctx.strokeStyle = '#ff6b35';
    ctx.lineWidth = 2;
    ctx.strokeRect(tx, ty, tw, th);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('BẪY', tx + tw/2, ty + th/2 + 4);
    ctx.fillStyle = 'rgba(255,100,0,0.15)';
    ctx.fillRect(tx, ty, tw, th);
  }

  // Start zones
  for (const [startFrac, col] of [[START_BLUE, '#00c8ff'], [START_RED, '#ff3030']]) {
    const sx = ARENA_X + startFrac.x * ARENA_W;
    const sy = ARENA_Y + startFrac.y * ARENA_H;
    ctx.fillStyle = col + '22';
    ctx.strokeStyle = col + '66';
    ctx.lineWidth = 2;
    ctx.setLineDash([4,4]);
    ctx.beginPath();
    ctx.roundRect(sx - 28, sy - 18, 56, 36, 4);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col + 'aa';
    ctx.font = 'bold 9px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('START', sx, sy + 4);
  }

  // Arena border
  ctx.strokeStyle = '#445544';
  ctx.lineWidth = 4;
  ctx.strokeRect(ARENA_X, ARENA_Y, ARENA_W, ARENA_H);

  // Outer wall
  ctx.fillStyle = '#2a3d2a';
  ctx.fillRect(0, 0, W, WALL);
  ctx.fillRect(0, H-WALL, W, WALL);
  ctx.fillRect(0, 0, WALL, H);
  ctx.fillRect(W-WALL, 0, WALL, H);

  ctx.strokeStyle = '#4a6a4a';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, W, H);

  // Robots
  if (blue.alive) drawRobot(blue, true);
  if (red.alive)  drawRobot(red,  false);

  // Game over overlay
  if (gameState === 'over') {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 36px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 20;
    ctx.fillText('TRẬN ĐẤU KẾT THÚC', W/2, H/2 - 10);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#aaa';
    ctx.font = '14px Rajdhani, sans-serif';
    ctx.fillText(`XANH: ${scoreBlue}đ  —  ĐỎ: ${scoreRed}đ`, W/2, H/2 + 30);
  }
}

function drawRobot(r, isBlue) {
  const pulseFactor = Math.sin(r.pulse) * 3;

  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.rotate(r.angle);

  // Shadow
  ctx.shadowColor = r.color;
  ctx.shadowBlur = 15 + pulseFactor;

  // Body
  const bodyW = ROBOT_R * 1.7, bodyH = ROBOT_R * 1.5;
  const grad = ctx.createLinearGradient(-bodyW/2, -bodyH/2, bodyW/2, bodyH/2);
  grad.addColorStop(0, r.colorDark);
  grad.addColorStop(1, r.color);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(-bodyW/2, -bodyH/2, bodyW, bodyH, 5);
  ctx.fill();

  // Border
  ctx.strokeStyle = r.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Front arrow (direction indicator)
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(bodyW/2 + 4, 0);
  ctx.lineTo(bodyW/2 - 4, -5);
  ctx.lineTo(bodyW/2 - 4,  5);
  ctx.closePath();
  ctx.fill();

  // Wheels
  ctx.fillStyle = '#222';
  for (const [wy, wh] of [[-bodyH/2 - 5, 5], [bodyH/2, 5]]) {
    ctx.fillRect(-bodyW/2, wy, bodyW, wh);
  }

  // "Eyes" / sensor
  ctx.fillStyle = '#fff';
  ctx.shadowBlur = 5;
  ctx.beginPath(); ctx.arc(4, -4, 4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(4,  4, 4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = isBlue ? '#001aff' : '#ff0000';
  ctx.beginPath(); ctx.arc(5, -4, 2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(5,  4, 2, 0, Math.PI*2); ctx.fill();

  ctx.shadowBlur = 0;
  ctx.restore();

  // Label
  ctx.fillStyle = r.color;
  ctx.font = 'bold 11px Orbitron, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(r.name, r.x, r.y - ROBOT_R - 8);

  // Trap warning flash
  if (r.inTrap) {
    ctx.save();
    ctx.globalAlpha = 0.3 + Math.abs(Math.sin(Date.now() * 0.005)) * 0.4;
    ctx.fillStyle = '#ff6600';
    ctx.beginPath();
    ctx.arc(r.x, r.y, ROBOT_R + 8, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

// ===== EVENTS =====
document.addEventListener('keydown', e => {
  keys[e.key] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

document.getElementById('btnStart').addEventListener('click', () => {
  if (gameState === 'idle') startGame();
});

document.getElementById('btnReset').addEventListener('click', () => {
  resetGame();
});

// Mobile touch swipe for blue robot
let touchStart = null;
canvas.addEventListener('touchstart', e => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  if (!touchStart) return;
  const dx = e.touches[0].clientX - touchStart.x;
  const dy = e.touches[0].clientY - touchStart.y;
  keys['ArrowRight'] = dx > 20;
  keys['ArrowLeft']  = dx < -20;
  keys['ArrowDown']  = dy > 20;
  keys['ArrowUp']    = dy < -20;
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', () => {
  keys = {};
  touchStart = null;
});

// D-Pad button controls
const dpadMap = {
  btnUp:    'ArrowUp',
  btnDown:  'ArrowDown',
  btnLeft:  'ArrowLeft',
  btnRight: 'ArrowRight',
};

for (const [id, key] of Object.entries(dpadMap)) {
  const btn = document.getElementById(id);
  if (!btn) continue;

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.classList.add('pressed');
    keys[key] = true;
    btn.setPointerCapture(e.pointerId);
  });

  btn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    btn.classList.remove('pressed');
    keys[key] = false;
  });

  btn.addEventListener('pointercancel', (e) => {
    btn.classList.remove('pressed');
    keys[key] = false;
  });

  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Init
resetGame();
