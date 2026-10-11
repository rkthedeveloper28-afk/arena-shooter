const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3000;
const MAP_WIDTH = 900;
const MAP_HEIGHT = 600;
const PLAYER_RADIUS = 14;
const WIN_SCORE = 100;

// --- STATIC OBSTACLE WALLS ---
const WALLS = [
  { x: 140, y: 120, w: 30, h: 140 },
  { x: 730, y: 120, w: 30, h: 140 },
  { x: 140, y: 340, w: 30, h: 140 },
  { x: 730, y: 340, w: 30, h: 140 },
  { x: 380, y: 260, w: 140, h: 40 }
];

// --- WEAPONS CATALOG ---
const WEAPONS = {
  pistol:  { name: 'Pistol', damage: 25, speed: 12, spread: 0.05, count: 1, cooldown: 350, life: 60, ammo: Infinity },
  shotgun: { name: 'Shotgun', damage: 16, speed: 10, spread: 0.25, count: 5, cooldown: 750, life: 35, ammo: 15 },
  smg:     { name: 'SMG', damage: 14, speed: 13, spread: 0.12, count: 1, cooldown: 110, life: 50, ammo: 45 },
  sniper:  { name: 'Sniper', damage: 85, speed: 22, spread: 0.01, count: 1, cooldown: 1100, life: 90, ammo: 8 },
  railgun: { name: 'Railgun', damage: 120, speed: 24, spread: 0, count: 1, cooldown: 1400, life: 100, ammo: 4 },
  minigun: { name: 'Minigun', damage: 16, speed: 11, spread: 0.2, count: 1, cooldown: 65, life: 55, ammo: 80 }
};

const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

// --- SERVER STATE ---
const players = {};
const bullets = [];
const powerups = [];
const airDrops = [];
let isMatchOver = false;

// --- TOXIC STORM CONTROLLER ---
const Storm = {
  x: MAP_WIDTH / 2,
  y: MAP_HEIGHT / 2,
  radius: 550,
  targetRadius: 75,
  minRadius: 60,
  shrinkRate: 0.12,
  damageInterval: 30,
  tickCounter: 0
};

// --- HTTP SERVER ---
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  let contentType = 'text/html';

  if (ext === '.js') contentType = 'text/javascript';
  else if (ext === '.css') contentType = 'text/css';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocket.Server({ server });

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function circleCollidesWithRect(cx, cy, cr, r) {
  const closestX = Math.max(r.x, Math.min(cx, r.x + r.w));
  const closestY = Math.max(r.y, Math.min(cy, r.y + r.h));
  const distX = cx - closestX;
  const distY = cy - closestY;
  return (distX * distX + distY * distY) < (cr * cr);
}

function collidesWithAnyWall(x, y, r) {
  return WALLS.some(w => circleCollidesWithRect(x, y, r, w));
}

function getSafeSpawn() {
  let x, y, safe = false;
  while (!safe) {
    x = 40 + Math.random() * (MAP_WIDTH - 80);
    y = 40 + Math.random() * (MAP_HEIGHT - 80);
    if (!collidesWithAnyWall(x, y, PLAYER_RADIUS + 10)) safe = true;
  }
  return { x, y };
}

function spawnPowerup() {
  if (powerups.length >= 5) return;
  const pos = getSafeSpawn();
  powerups.push({
    id: Math.random().toString(36).substring(2, 7),
    x: pos.x,
    y: pos.y,
    type: Math.random() > 0.4 ? 'shield' : 'shotgun'
  });
}
setInterval(spawnPowerup, 8000);

function spawnAirDrop() {
  if (isMatchOver) return;
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * Math.max(30, Storm.radius - 40);
  const targetX = Math.max(50, Math.min(MAP_WIDTH - 50, Storm.x + Math.cos(angle) * dist));
  const targetY = Math.max(50, Math.min(MAP_HEIGHT - 50, Storm.y + Math.sin(angle) * dist));

  const legWeapons = ['railgun', 'minigun'];
  airDrops.push({
    id: Math.random().toString(36).substring(2, 7),
    x: targetX,
    y: targetY,
    altitude: 400,
    landed: false,
    weaponType: legWeapons[Math.floor(Math.random() * legWeapons.length)]
  });
}
setInterval(spawnAirDrop, 25000);

function resetMatch() {
  isMatchOver = false;
  Storm.radius = 550;
  Storm.x = MAP_WIDTH / 2;
  Storm.y = MAP_HEIGHT / 2;
  airDrops.length = 0;
  bullets.length = 0;
  powerups.length = 0;

  for (const pid in players) {
    const p = players[pid];
    const spawn = getSafeSpawn();
    p.x = spawn.x;
    p.y = spawn.y;
    p.hp = p.maxHp;
    p.shield = 0;
    p.score = 0;
    p.weapon = 'pistol';
    p.ammo = Infinity;
  }
  broadcast({ type: 'match_restart' });
}

// --- WEBSOCKET CONNECTION ---
wss.on('connection', (ws) => {
  const id = Math.random().toString(36).substring(2, 9);
  ws.playerId = id;
  const spawn = getSafeSpawn();

  players[id] = {
    id,
    name: `Player_${id.substring(0, 3)}`,
    costume: 'spec_ops',
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    score: 0,
    hp: 100,
    maxHp: 100,
    shield: 25,
    maxShield: 50,
    weapon: 'pistol',
    ammo: Infinity,
    lastShotTime: 0,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    isDashing: false,
    dashEndTime: 0,
    lastDashTime: 0,
    dashVx: 0,
    dashVy: 0
  };

  ws.send(JSON.stringify({
    type: 'init',
    id,
    map: { width: MAP_WIDTH, height: MAP_HEIGHT, walls: WALLS },
    storm: { x: Storm.x, y: Storm.y, radius: Storm.radius }
  }));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      const player = players[id];
      if (!player) return;

      if (isMatchOver && (data.type === 'input' || data.type === 'shoot' || data.type === 'dash')) return;

      if (data.type === 'setName' && data.name) {
        player.name = String(data.name).substring(0, 10);
      }

      if (data.type === 'select_costume' && data.costumeId) {
        player.costume = data.costumeId;
      }

      if (data.type === 'input') {
        player.angle = data.angle;
        if (!player.isDashing) {
          const speed = 4;
          let dx = 0, dy = 0;
          if (data.keys.left) dx -= 1;
          if (data.keys.right) dx += 1;
          if (data.keys.up) dy -= 1;
          if (data.keys.down) dy += 1;

          if (dx !== 0 || dy !== 0) {
            const mag = Math.hypot(dx, dy);
            const moveX = (dx / mag) * speed;
            const moveY = (dy / mag) * speed;
            const nextX = player.x + moveX;
            const nextY = player.y + moveY;

            if (nextX >= PLAYER_RADIUS && nextX <= MAP_WIDTH - PLAYER_RADIUS && !collidesWithAnyWall(nextX, player.y, PLAYER_RADIUS)) {
              player.x = nextX;
            }
            if (nextY >= PLAYER_RADIUS && nextY <= MAP_HEIGHT - PLAYER_RADIUS && !collidesWithAnyWall(player.x, nextY, PLAYER_RADIUS)) {
              player.y = nextY;
            }
          }
        }
      }

      if (data.type === 'dash') {
        const now = Date.now();
        if (now - player.lastDashTime >= 1400 && !player.isDashing) {
          player.isDashing = true;
          player.lastDashTime = now;
          player.dashEndTime = now + 180;

          let mx = 0, my = 0;
          if (data.keys.left) mx -= 1;
          if (data.keys.right) mx += 1;
          if (data.keys.up) my -= 1;
          if (data.keys.down) my += 1;

          const mag = Math.hypot(mx, my);
          const dashSpeed = 14;
          if (mag > 0) {
            player.dashVx = (mx / mag) * dashSpeed;
            player.dashVy = (my / mag) * dashSpeed;
          } else {
            player.dashVx = Math.cos(player.angle) * dashSpeed;
            player.dashVy = Math.sin(player.angle) * dashSpeed;
          }
          broadcast({ type: 'effect', effectType: 'dash_start', x: player.x, y: player.y });
        }
      }

      if (data.type === 'shoot') {
        const now = Date.now();
        const wpn = WEAPONS[player.weapon] || WEAPONS.pistol;

        if (now - player.lastShotTime >= wpn.cooldown) {
          player.lastShotTime = now;

          if (player.ammo !== Infinity) {
            player.ammo--;
            if (player.ammo <= 0) {
              player.weapon = 'pistol';
              player.ammo = Infinity;
            }
          }

          for (let i = 0; i < wpn.count; i++) {
            const spread = (Math.random() - 0.5) * wpn.spread;
            const finalAngle = player.angle + spread;
            bullets.push({
              id: Math.random().toString(36).substring(2, 7),
              ownerId: id,
              x: player.x + Math.cos(player.angle) * (PLAYER_RADIUS + 5),
              y: player.y + Math.sin(player.angle) * (PLAYER_RADIUS + 5),
              vx: Math.cos(finalAngle) * wpn.speed,
              vy: Math.sin(finalAngle) * wpn.speed,
              damage: wpn.damage,
              life: wpn.life,
              color: player.color
            });
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.on('close', () => {
    delete players[id];
  });
});

// --- 60 FPS MAIN SIMULATION LOOP ---
setInterval(() => {
  const now = Date.now();

  // Storm Shrink & Damage
  if (Storm.radius > Storm.targetRadius) {
    Storm.radius = Math.max(Storm.targetRadius, Storm.radius - Storm.shrinkRate);
  }
  Storm.tickCounter++;
  const stormTick = Storm.tickCounter % Storm.damageInterval === 0;

  for (const pid in players) {
    const p = players[pid];

    // Dash expiration & translation
    if (p.isDashing) {
      if (now >= p.dashEndTime) {
        p.isDashing = false;
        p.dashVx = 0;
        p.dashVy = 0;
      } else {
        const nx = p.x + p.dashVx;
        const ny = p.y + p.dashVy;
        if (nx >= PLAYER_RADIUS && nx <= MAP_WIDTH - PLAYER_RADIUS && !collidesWithAnyWall(nx, p.y, PLAYER_RADIUS)) p.x = nx;
        if (ny >= PLAYER_RADIUS && ny <= MAP_HEIGHT - PLAYER_RADIUS && !collidesWithAnyWall(p.x, ny, PLAYER_RADIUS)) p.y = ny;
      }
    }

    // Storm damage check
    if (Math.hypot(p.x - Storm.x, p.y - Storm.y) > Storm.radius && stormTick) {
      p.hp -= 6;
      broadcast({ type: 'effect', effectType: 'storm_damage', x: p.x, y: p.y });
      if (p.hp <= 0) {
        broadcast({ type: 'kill_feed', killer: 'Storm', killerColor: '#c084fc', victim: p.name, victimColor: p.color, weapon: 'storm' });
        const respawn = getSafeSpawn();
        p.x = respawn.x;
        p.y = respawn.y;
        p.hp = p.maxHp;
        p.shield = 0;
      }
    }
  }

  // Air Drops Simulation
  for (let i = airDrops.length - 1; i >= 0; i--) {
    const drop = airDrops[i];
    if (!drop.landed) {
      drop.altitude -= 1.8;
      if (drop.altitude <= 0) {
        drop.altitude = 0;
        drop.landed = true;
        broadcast({ type: 'effect', effectType: 'crate_impact', x: drop.x, y: drop.y });
      }
    } else {
      for (const pid in players) {
        const p = players[pid];
        if (Math.hypot(p.x - drop.x, p.y - drop.y) < PLAYER_RADIUS + 16) {
          p.weapon = drop.weaponType;
          p.ammo = WEAPONS[drop.weaponType].ammo;
          p.shield = p.maxShield;
          broadcast({ type: 'kill_feed', killer: p.name, killerColor: p.color, victim: `found ${WEAPONS[drop.weaponType].name}!`, victimColor: '#facc15', weapon: drop.weaponType });
          airDrops.splice(i, 1);
          break;
        }
      }
    }
  }

  // Bullets Simulation & Collision
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    let hit = false;
    if (b.life <= 0 || b.x < 0 || b.x > MAP_WIDTH || b.y < 0 || b.y > MAP_HEIGHT || collidesWithAnyWall(b.x, b.y, 4)) {
      hit = true;
    } else {
      for (const pid in players) {
        if (pid !== b.ownerId) {
          const p = players[pid];
          if (Math.hypot(p.x - b.x, p.y - b.y) < PLAYER_RADIUS + 4) {
            if (p.isDashing) continue; // I-Frames pass-through

            hit = true;
            let dmg = b.damage;
            if (p.shield > 0) {
              if (p.shield >= dmg) {
                p.shield -= dmg;
                dmg = 0;
              } else {
                dmg -= p.shield;
                p.shield = 0;
              }
            }
            p.hp -= dmg;

            if (p.hp <= 0) {
              const killer = players[b.ownerId];
              if (killer) {
                killer.score += 10;
                broadcast({ type: 'kill_feed', killer: killer.name, killerColor: killer.color, victim: p.name, victimColor: p.color, weapon: killer.weapon });

                if (killer.score >= WIN_SCORE && !isMatchOver) {
                  isMatchOver = true;
                  broadcast({ type: 'game_over', winner: killer.name, winnerColor: killer.color });
                  setTimeout(resetMatch, 8000);
                }
              }
              const respawn = getSafeSpawn();
              p.x = respawn.x;
              p.y = respawn.y;
              p.hp = p.maxHp;
              p.shield = 0;
            }
            break;
          }
        }
      }
    }
    if (hit) bullets.splice(i, 1);
  }

  // Power-up Pickups
  for (let i = powerups.length - 1; i >= 0; i--) {
    const pup = powerups[i];
    for (const pid in players) {
      const p = players[pid];
      if (Math.hypot(p.x - pup.x, p.y - pup.y) < PLAYER_RADIUS + 12) {
        if (pup.type === 'shield') p.shield = Math.min(p.maxShield, p.shield + 25);
        else {
          p.weapon = 'shotgun';
          p.ammo = 15;
        }
        powerups.splice(i, 1);
        break;
      }
    }
  }

  broadcast({
    type: 'state',
    players,
    bullets,
    powerups,
    airDrops,
    storm: { x: Storm.x, y: Storm.y, radius: Storm.radius }
  });
}, 1000 / 60);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Arena running at http://localhost:${PORT}`);
});