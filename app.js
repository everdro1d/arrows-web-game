const CONFIG = {
  COLOR_BACKGROUND: '#FFFFFF',
  COLOR_ARROW_DEFAULT: '#000000',
  COLOR_ARROW_ACTIVE: '#0000FF',
  COLOR_ARROW_BLOCKED: '#FF0000',
  COLOR_EMPTY_DOT: '#CCCCCC',
  CELL_SIZE: 50,
  EMPTY_DOT_RADIUS_RATIO: 0.10,
  ARROW_STROKE_RATIO: 0.20,
  ARROW_HEAD_RATIO: 0.50,
  RAY_WIDTH_RATIO: 0.05,
  COLOR_RAY: '#D0E8F0',
  BLOCKED_SHAKE_MS: 260,
  BLOCKED_FLASH_MS: 340,
  FIRE_SPEED_CELLS_PER_SEC: 10,
  DIFFICULTIES: {
    easy: { name: 'Easy', size: 6, arrowCount: 8 },
    medium: { name: 'Medium', size: 10, arrowCount: 20 },
    hard: { name: 'Hard', size: 15, arrowCount: 45 },
    superHard: { name: 'Super Hard', size: 25, arrowCount: 120 }
  }
};

const DIRS = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 }
};
const DIR_KEYS = Object.keys(DIRS);

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const raysToggle = document.getElementById('rays-toggle');
const menuButton = document.getElementById('menu-button');
const menuModal = document.getElementById('menu-modal');
const difficultyModal = document.getElementById('difficulty-modal');
const winModal = document.getElementById('win-modal');
const restartButton = document.getElementById('restart-level');
const returnSelectButton = document.getElementById('return-select');
const menuCloseButton = document.getElementById('menu-close');
const newLevelButton = document.getElementById('new-level');
const mainMenuButton = document.getElementById('main-menu');
const winTitle = document.getElementById('win-title');
const winTime = document.getElementById('win-time');
const winCount = document.getElementById('win-count');

const state = {
  difficultyKey: null,
  gridSize: 0,
  grid: [],
  arrows: new Map(),
  nextArrowId: 1,
  showRays: false,
  hoverArrowId: null,
  animations: [],
  activeArrowId: null,
  startTime: 0,
  endTime: 0,
  completed: false,
  clearedCount: 0,
  view: {
    scale: 1,
    panX: 0,
    panY: 0
  },
  pointer: {
    mouseDown: false,
    dragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    downArrowId: null,
    downOnEmpty: false,
    touchMode: null,
    pinchDistance: 0,
    pinchCenter: null
  }
};

function randInt(max) {
  return Math.floor(Math.random() * max);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = randInt(i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function createEmptyGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(null));
}

function inBounds(x, y, size) {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function getCellCenter(cell) {
  return { x: cell.x + 0.5, y: cell.y + 0.5 };
}

function generateSpanningForestPaths(size, targetCount) {
  const totalCells = size * size;
  const parent = new Int32Array(totalCells);
  const degree = new Uint8Array(totalCells);

  for (let i = 0; i < totalCells; i += 1) {
    parent[i] = i;
  }

  function find(i) {
    let root = i;
    while (root !== parent[root]) root = parent[root];
    let curr = i;
    while (curr !== root) {
      const nxt = parent[curr];
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  }

  const edges = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = y * size + x;
      if (x < size - 1) edges.push([u, u + 1]);
      if (y < size - 1) edges.push([u, u + size]);
    }
  }
  shuffle(edges);

  let currentPaths = totalCells;
  const adjacency = Array.from({ length: totalCells }, () => []);

  for (const [u, v] of edges) {
    if (currentPaths <= targetCount) break;
    if (degree[u] >= 2 || degree[v] >= 2) continue;

    const rootU = find(u);
    const rootV = find(v);
    if (rootU !== rootV) {
      parent[rootU] = rootV;
      degree[u] += 1;
      degree[v] += 1;
      adjacency[u].push(v);
      adjacency[v].push(u);
      currentPaths -= 1;
    }
  }

  const visited = new Uint8Array(totalCells);
  const paths = [];
  for (let i = 0; i < totalCells; i += 1) {
    if (!visited[i] && degree[i] <= 1) {
      const path = [];
      let curr = i;
      let prev = -1;
      while (curr !== undefined) {
        visited[curr] = 1;
        path.push({ x: curr % size, y: Math.floor(curr / size) });
        const next = adjacency[curr].find(n => n !== prev);
        prev = curr;
        curr = next;
      }
      paths.push(path);
    }
  }

  return paths;
}

function resolveExits(paths, size) {
  const currentPaths = paths.map((p, i) => ({ id: i + 1, cells: [...p] }));
  const grid = createEmptyGrid(size);
  for (const p of currentPaths) {
    for (const c of p.cells) {
      grid[c.y][c.x] = p.id;
    }
  }

  const removed = [];
  while (currentPaths.length > 0) {
    let found = false;
    for (let i = 0; i < currentPaths.length; i += 1) {
      const p = currentPaths[i];
      const endpoints = p.cells.length > 1 ? [p.cells[0], p.cells[p.cells.length - 1]] : [p.cells[0]];
      shuffle(endpoints);
      const dirs = shuffle([...DIR_KEYS]);

      for (const head of endpoints) {
        const body1 = p.cells.length > 1
          ? (head === p.cells[0] ? p.cells[1] : p.cells[p.cells.length - 2])
          : null;

        for (const dirKey of dirs) {
          const dir = DIRS[dirKey];

          // Ensure the first body cell is directly behind the head
          if (body1 && (body1.x !== head.x - dir.x || body1.y !== head.y - dir.y)) {
            continue;
          }

          // Ensure the exit ray is completely unobstructed by any cell (including own body)
          let cx = head.x + dir.x;
          let cy = head.y + dir.y;
          let clear = true;

          while (inBounds(cx, cy, size)) {
            if (grid[cy][cx] !== null) {
              clear = false;
              break;
            }
            cx += dir.x;
            cy += dir.y;
          }

          if (clear) {
            if (head === p.cells[p.cells.length - 1]) {
              p.cells.reverse();
            }
            p.headDir = dirKey;
            removed.push(p);
            for (const c of p.cells) {
              grid[c.y][c.x] = null;
            }
            currentPaths.splice(i, 1);
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
    if (!found) return null;
  }

  const arrowMap = new Map();
  for (const p of removed) {
    arrowMap.set(p.id, {
      id: p.id,
      headDir: p.headDir,
      cells: p.cells,
      blockedUntil: 0,
      shakeUntil: 0,
      queued: false,
      firing: false
    });
  }
  return arrowMap;
}

function generateBoard(difficultyKey) {
  const diff = CONFIG.DIFFICULTIES[difficultyKey];
  const size = diff.size;

  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const paths = generateSpanningForestPaths(size, diff.arrowCount);
    const arrows = resolveExits(paths, size);

    if (arrows) {
      const grid = createEmptyGrid(size);
      for (const arrow of arrows.values()) {
        for (const cell of arrow.cells) {
          grid[cell.y][cell.x] = arrow.id;
        }
      }
      return { size, grid, arrows, nextArrowId: diff.arrowCount + 1 };
    }
  }

  throw new Error('Failed to generate a solvable board.');
}

function resetView() {
  const minDim = Math.min(canvas.width, canvas.height);
  const boardPixels = state.gridSize * CONFIG.CELL_SIZE;
  state.view.scale = (minDim * 0.8) / boardPixels;
  const centerX = (state.gridSize * CONFIG.CELL_SIZE) / 2;
  const centerY = (state.gridSize * CONFIG.CELL_SIZE) / 2;
  state.view.panX = canvas.width / 2 - centerX * state.view.scale;
  state.view.panY = canvas.height / 2 - centerY * state.view.scale;
}

function setModalVisible(modal, visible) {
  modal.classList.toggle('visible', visible);
}

function openDifficultyModal() {
  setModalVisible(difficultyModal, true);
  setModalVisible(menuModal, false);
  setModalVisible(winModal, false);
}

function closeAllModals() {
  setModalVisible(difficultyModal, false);
  setModalVisible(menuModal, false);
  setModalVisible(winModal, false);
}

function loadBoard(board) {
  state.gridSize = board.size;
  state.grid = board.grid.map((row) => [...row]);
  state.arrows = new Map();
  board.arrows.forEach((arrow) => {
    state.arrows.set(arrow.id, { ...arrow, cells: arrow.cells.map((c) => ({ ...c })) });
  });
  state.nextArrowId = board.nextArrowId;
  state.hoverArrowId = null;
  state.animations = [];
  state.activeArrowId = null;
  state.startTime = performance.now();
  state.endTime = 0;
  state.completed = false;
  state.clearedCount = 0;
  resetView();
  closeAllModals();
}

function startGame(difficultyKey) {
  state.difficultyKey = difficultyKey;
  const board = generateBoard(difficultyKey);
  state.initialBoard = {
    size: board.size,
    grid: board.grid.map((row) => [...row]),
    arrows: Array.from(board.arrows.values()).map((a) => ({
      ...a,
      cells: a.cells.map((c) => ({ ...c }))
    })),
    nextArrowId: board.nextArrowId
  };
  loadBoard(board);
}

function restartLevel() {
  if (state.initialBoard) {
    const board = {
      size: state.initialBoard.size,
      grid: state.initialBoard.grid.map((row) => [...row]),
      arrows: new Map(),
      nextArrowId: state.initialBoard.nextArrowId
    };
    state.initialBoard.arrows.forEach((a) => {
      board.arrows.set(a.id, { ...a, cells: a.cells.map((c) => ({ ...c })) });
    });
    loadBoard(board);
  }
}

function formatDuration(ms) {
  const total = ms / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function worldToScreen(point) {
  return {
    x: point.x * CONFIG.CELL_SIZE * state.view.scale + state.view.panX,
    y: point.y * CONFIG.CELL_SIZE * state.view.scale + state.view.panY
  };
}

function screenToWorld(x, y) {
  return {
    x: (x - state.view.panX) / (CONFIG.CELL_SIZE * state.view.scale),
    y: (y - state.view.panY) / (CONFIG.CELL_SIZE * state.view.scale)
  };
}

function setScaleAroundPoint(nextScale, sx, sy) {
  const world = screenToWorld(sx, sy);
  state.view.scale = nextScale > 0 ? nextScale : state.view.scale;
  const after = worldToScreen(world);
  state.view.panX += sx - after.x;
  state.view.panY += sy - after.y;
}

function arrowColor(arrow, now) {
  if (arrow.blockedUntil > now) {
    return CONFIG.COLOR_ARROW_BLOCKED;
  }
  if (arrow.firing || state.hoverArrowId === arrow.id || state.activeArrowId === arrow.id) {
    return CONFIG.COLOR_ARROW_ACTIVE;
  }
  return CONFIG.COLOR_ARROW_DEFAULT;
}

function isPathBlocked(arrow) {
  const head = arrow.cells[0];
  const dir = DIRS[arrow.headDir];
  let x = head.x + dir.x;
  let y = head.y + dir.y;
  while (inBounds(x, y, state.gridSize)) {
    if (state.grid[y][x]) {
      return true;
    }
    x += dir.x;
    y += dir.y;
  }
  return false;
}

function removeArrowFromGrid(arrow) {
  for (const cell of arrow.cells) {
    if (state.grid[cell.y][cell.x] === arrow.id) {
      state.grid[cell.y][cell.x] = null;
    }
  }
}

function buildAnimationPath(arrow) {
  return [...arrow.cells].reverse().map(getCellCenter);
}

function positionOnPath(path, offset) {
  let remaining = offset;
  for (let i = path.length - 1; i > 0; i -= 1) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const seg = Math.hypot(dx, dy);
    if (remaining <= seg) {
      const t = (seg - remaining) / seg;
      return { x: a.x + dx * t, y: a.y + dy * t };
    }
    remaining -= seg;
  }
  return { ...path[0] };
}

function startArrowAnimation(arrowId) {
  const arrow = state.arrows.get(arrowId);
  if (!arrow || arrow.firing) {
    return;
  }
  arrow.firing = true;
  removeArrowFromGrid(arrow);
  state.animations.push({
    arrowId: arrow.id,
    headDir: arrow.headDir,
    path: buildAnimationPath(arrow),
    distance: 0,
    length: arrow.cells.length,
    offscreenDistance: state.gridSize + arrow.cells.length + 8
  });
}

function fireArrow(arrowId) {
  const arrow = state.arrows.get(arrowId);
  if (!arrow || state.completed || arrow.firing) {
    return;
  }
  if (isPathBlocked(arrow)) {
    const now = performance.now();
    arrow.blockedUntil = now + CONFIG.BLOCKED_FLASH_MS;
    arrow.shakeUntil = now + CONFIG.BLOCKED_SHAKE_MS;
    return;
  }
  startArrowAnimation(arrow.id);
}

function getPraise(seconds) {
  if (seconds < 20) return 'Legendary!';
  if (seconds < 50) return 'Flawless!';
  return 'Super!';
}

function checkWin(now) {
  if (state.completed) {
    return;
  }
  if (state.arrows.size === 0 && state.animations.length === 0) {
    state.completed = true;
    state.endTime = now;
    const totalSeconds = (state.endTime - state.startTime) / 1000;
    winTitle.textContent = getPraise(totalSeconds);
    winTime.textContent = `Time: ${formatDuration(state.endTime - state.startTime)}`;
    winCount.textContent = `Arrows cleared: ${state.clearedCount}`;
    setModalVisible(winModal, true);
  }
}

function updateAnimation(dt, now) {
  for (let i = state.animations.length - 1; i >= 0; i -= 1) {
    const anim = state.animations[i];
    anim.distance += dt * CONFIG.FIRE_SPEED_CELLS_PER_SEC;
    const head = positionOnPath(anim.path, 0);
    const dir = DIRS[anim.headDir];
    const newHead = {
      x: head.x + dir.x * dt * CONFIG.FIRE_SPEED_CELLS_PER_SEC,
      y: head.y + dir.y * dt * CONFIG.FIRE_SPEED_CELLS_PER_SEC
    };
    anim.path.push(newHead);

    const tailPos = positionOnPath(anim.path, anim.length - 1);
    const offscreen =
      tailPos.x < -4 ||
      tailPos.y < -4 ||
      tailPos.x > state.gridSize + 4 ||
      tailPos.y > state.gridSize + 4 ||
      anim.distance > anim.offscreenDistance;

    if (offscreen) {
      state.arrows.delete(anim.arrowId);
      state.clearedCount += 1;
      state.animations.splice(i, 1);
      checkWin(now);
    }
  }
}

function getArrowAtWorldPoint(wx, wy) {
  const x = Math.floor(wx);
  const y = Math.floor(wy);
  if (!inBounds(x, y, state.gridSize)) {
    return null;
  }
  return state.grid[y][x];
}

function drawArrowCells(cells, dirKey, color, offsetX = 0, offsetY = 0) {
  const stroke = CONFIG.CELL_SIZE * CONFIG.ARROW_STROKE_RATIO * state.view.scale;
  const headSize = CONFIG.CELL_SIZE * CONFIG.ARROW_HEAD_RATIO * state.view.scale;
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  cells.forEach((cell, idx) => {
    const p = worldToScreen(getCellCenter(cell));
    if (idx === 0) {
      ctx.moveTo(p.x + offsetX, p.y + offsetY);
    } else {
      ctx.lineTo(p.x + offsetX, p.y + offsetY);
    }
  });
  ctx.stroke();

  const head = worldToScreen(getCellCenter(cells[0]));
  const dir = DIRS[dirKey];
  const tip = {
    x: head.x + dir.x * headSize * 0.45 + offsetX,
    y: head.y + dir.y * headSize * 0.45 + offsetY
  };
  const perp = { x: -dir.y, y: dir.x };
  const sideA = {
    x: head.x - dir.x * headSize * 0.35 + perp.x * headSize * 0.4 + offsetX,
    y: head.y - dir.y * headSize * 0.35 + perp.y * headSize * 0.4 + offsetY
  };
  const sideB = {
    x: head.x - dir.x * headSize * 0.35 - perp.x * headSize * 0.4 + offsetX,
    y: head.y - dir.y * headSize * 0.35 - perp.y * headSize * 0.4 + offsetY
  };

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(sideA.x, sideA.y);
  ctx.lineTo(sideB.x, sideB.y);
  ctx.closePath();
  ctx.fill();
}

function drawAnimatedArrow(anim, color) {
  const cells = [];
  for (let i = 0; i < anim.length; i += 1) {
    cells.push(positionOnPath(anim.path, i));
  }

  const stroke = CONFIG.CELL_SIZE * CONFIG.ARROW_STROKE_RATIO * state.view.scale;
  const headSize = CONFIG.CELL_SIZE * CONFIG.ARROW_HEAD_RATIO * state.view.scale;
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  cells.forEach((p, idx) => {
    const sp = worldToScreen(p);
    if (idx === 0) {
      ctx.moveTo(sp.x, sp.y);
    } else {
      ctx.lineTo(sp.x, sp.y);
    }
  });
  ctx.stroke();

  const dir = DIRS[anim.headDir];
  const h = worldToScreen(cells[0]);
  const tip = { x: h.x + dir.x * headSize * 0.45, y: h.y + dir.y * headSize * 0.45 };
  const perp = { x: -dir.y, y: dir.x };
  const sideA = { x: h.x - dir.x * headSize * 0.35 + perp.x * headSize * 0.4, y: h.y - dir.y * headSize * 0.35 + perp.y * headSize * 0.4 };
  const sideB = { x: h.x - dir.x * headSize * 0.35 - perp.x * headSize * 0.4, y: h.y - dir.y * headSize * 0.35 - perp.y * headSize * 0.4 };
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(sideA.x, sideA.y);
  ctx.lineTo(sideB.x, sideB.y);
  ctx.closePath();
  ctx.fill();
}

function rayEndFromHead(head, dir) {
  const big = state.gridSize + 12;
  return { x: head.x + dir.x * big, y: head.y + dir.y * big };
}

function drawRays(now) {
  if (!state.showRays) return;
  const width = CONFIG.CELL_SIZE * CONFIG.RAY_WIDTH_RATIO * state.view.scale;
  ctx.lineWidth = Math.max(1, width);
  ctx.strokeStyle = CONFIG.COLOR_RAY;

  for (const arrow of state.arrows.values()) {
    if (arrow.firing) continue;
    const start = worldToScreen(getCellCenter(arrow.cells[0]));
    const dir = DIRS[arrow.headDir];
    const end = worldToScreen(rayEndFromHead(getCellCenter(arrow.cells[0]), dir));
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
}

function drawGridDots() {
  const radius = CONFIG.CELL_SIZE * CONFIG.EMPTY_DOT_RADIUS_RATIO * state.view.scale;
  ctx.fillStyle = CONFIG.COLOR_EMPTY_DOT;
  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = 0; x < state.gridSize; x += 1) {
      if (state.grid[y][x]) continue;
      const c = worldToScreen({ x: x + 0.5, y: y + 0.5 });
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function render(now) {
  ctx.fillStyle = CONFIG.COLOR_BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!state.gridSize) {
    return;
  }

  drawGridDots();
  drawRays(now);

  for (const arrow of state.arrows.values()) {
    if (arrow.firing) continue;
    const color = arrowColor(arrow, now);
    let shakeX = 0;
    let shakeY = 0;
    if (arrow.shakeUntil > now) {
      const s = Math.sin(now * 0.06) * 4;
      if (arrow.headDir === 'N' || arrow.headDir === 'S') {
        shakeX = s;
      } else {
        shakeY = s;
      }
    }
    drawArrowCells(arrow.cells, arrow.headDir, color, shakeX, shakeY);
  }

  for (const anim of state.animations) {
    drawAnimatedArrow(anim, CONFIG.COLOR_ARROW_ACTIVE);
  }
}

function resizeCanvas() {
  const width = Math.floor(window.innerWidth);
  const height = Math.floor(window.innerHeight);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    if (state.gridSize) {
      resetView();
    }
  }
}

let lastFrame = performance.now();
function frame(now) {
  resizeCanvas();
  const dt = Math.max(0.001, (now - lastFrame) / 1000);
  lastFrame = now;
  updateAnimation(dt, now);
  render(now);
  requestAnimationFrame(frame);
}

function onMouseDown(e) {
  if (!state.gridSize || menuModal.classList.contains('visible') || winModal.classList.contains('visible') || difficultyModal.classList.contains('visible')) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const world = screenToWorld(x, y);
  const arrowId = getArrowAtWorldPoint(world.x, world.y);
  state.pointer.mouseDown = true;
  state.pointer.dragging = false;
  state.pointer.startX = x;
  state.pointer.startY = y;
  state.pointer.lastX = x;
  state.pointer.lastY = y;
  state.pointer.downArrowId = arrowId;
  state.pointer.downOnEmpty = !arrowId;
}

function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (state.pointer.mouseDown) {
    const dx = x - state.pointer.lastX;
    const dy = y - state.pointer.lastY;
    const moved = Math.hypot(x - state.pointer.startX, y - state.pointer.startY) > 5;
    if (moved) {
      state.pointer.dragging = true;
      state.view.panX += dx;
      state.view.panY += dy;
    }
    state.pointer.lastX = x;
    state.pointer.lastY = y;
    return;
  }

  const world = screenToWorld(x, y);
  state.hoverArrowId = getArrowAtWorldPoint(world.x, world.y);
}

function onMouseUp(e) {
  if (!state.pointer.mouseDown) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const world = screenToWorld(x, y);
  const upArrowId = getArrowAtWorldPoint(world.x, world.y);

  if (!state.pointer.dragging && state.pointer.downArrowId && state.pointer.downArrowId === upArrowId) {
    fireArrow(upArrowId);
  }

  state.pointer.mouseDown = false;
  state.pointer.dragging = false;
}

function onWheel(e) {
  e.preventDefault();
  const zoom = Math.exp(-e.deltaY * 0.0018);
  setScaleAroundPoint(state.view.scale * zoom, e.clientX, e.clientY);
}

function touchDistance(t0, t1) {
  return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
}

function touchCenter(t0, t1) {
  return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
}

function onTouchStart(e) {
  if (!state.gridSize || difficultyModal.classList.contains('visible') || menuModal.classList.contains('visible') || winModal.classList.contains('visible')) {
    return;
  }
  if (e.touches.length === 2) {
    state.pointer.touchMode = 'pinch';
    state.pointer.pinchDistance = touchDistance(e.touches[0], e.touches[1]);
    state.pointer.pinchCenter = touchCenter(e.touches[0], e.touches[1]);
    return;
  }
  if (e.touches.length === 1) {
    state.pointer.touchMode = 'single';
    const t = e.touches[0];
    const world = screenToWorld(t.clientX, t.clientY);
    state.pointer.startX = t.clientX;
    state.pointer.startY = t.clientY;
    state.pointer.lastX = t.clientX;
    state.pointer.lastY = t.clientY;
    state.pointer.dragging = false;
    state.pointer.downArrowId = getArrowAtWorldPoint(world.x, world.y);
    state.hoverArrowId = state.pointer.downArrowId;
  }
}

function onTouchMove(e) {
  if (state.pointer.touchMode === 'pinch' && e.touches.length === 2) {
    e.preventDefault();
    const dist = touchDistance(e.touches[0], e.touches[1]);
    const center = touchCenter(e.touches[0], e.touches[1]);
    if (state.pointer.pinchDistance > 0) {
      const ratio = dist / state.pointer.pinchDistance;
      setScaleAroundPoint(state.view.scale * ratio, center.x, center.y);
    }
    if (state.pointer.pinchCenter) {
      state.view.panX += center.x - state.pointer.pinchCenter.x;
      state.view.panY += center.y - state.pointer.pinchCenter.y;
    }
    state.pointer.pinchDistance = dist;
    state.pointer.pinchCenter = center;
    return;
  }

  if (state.pointer.touchMode === 'single' && e.touches.length === 1) {
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - state.pointer.lastX;
    const dy = t.clientY - state.pointer.lastY;
    const moved = Math.hypot(t.clientX - state.pointer.startX, t.clientY - state.pointer.startY) > 6;
    if (moved) {
      state.pointer.dragging = true;
      if (!state.pointer.downArrowId) {
        state.view.panX += dx;
        state.view.panY += dy;
      }
    }
    state.pointer.lastX = t.clientX;
    state.pointer.lastY = t.clientY;
  }
}

function onTouchEnd(e) {
  if (state.pointer.touchMode === 'single' && !state.pointer.dragging && e.changedTouches.length > 0) {
    const t = e.changedTouches[0];
    const world = screenToWorld(t.clientX, t.clientY);
    const arrowId = getArrowAtWorldPoint(world.x, world.y);
    if (arrowId && arrowId === state.pointer.downArrowId) {
      fireArrow(arrowId);
    }
  }
  if (e.touches.length === 0) {
    state.pointer.touchMode = null;
    state.pointer.dragging = false;
    state.hoverArrowId = null;
  } else if (e.touches.length === 1) {
    state.pointer.touchMode = 'single';
    state.pointer.startX = e.touches[0].clientX;
    state.pointer.startY = e.touches[0].clientY;
    state.pointer.lastX = e.touches[0].clientX;
    state.pointer.lastY = e.touches[0].clientY;
    state.pointer.dragging = false;
  }
}

canvas.addEventListener('mousedown', onMouseDown);
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('wheel', onWheel, { passive: false });
canvas.addEventListener('touchstart', onTouchStart, { passive: false });
canvas.addEventListener('touchmove', onTouchMove, { passive: false });
canvas.addEventListener('touchend', onTouchEnd, { passive: false });
canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

menuButton.addEventListener('click', () => {
  if (!state.gridSize) return;
  setModalVisible(menuModal, true);
});
menuCloseButton.addEventListener('click', () => setModalVisible(menuModal, false));
restartButton.addEventListener('click', () => {
  restartLevel();
});
returnSelectButton.addEventListener('click', () => {
  state.gridSize = 0;
  state.arrows.clear();
  openDifficultyModal();
});
newLevelButton.addEventListener('click', () => {
  if (state.difficultyKey) {
    startGame(state.difficultyKey);
  }
});
mainMenuButton.addEventListener('click', () => {
  state.gridSize = 0;
  state.arrows.clear();
  openDifficultyModal();
});

raysToggle.addEventListener('click', () => {
  state.showRays = !state.showRays;
  raysToggle.textContent = `Rays: ${state.showRays ? 'On' : 'Off'}`;
});

document.querySelectorAll('[data-difficulty]').forEach((button) => {
  button.addEventListener('click', () => startGame(button.dataset.difficulty));
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

openDifficultyModal();
requestAnimationFrame(frame);
