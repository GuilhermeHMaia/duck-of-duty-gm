import './style.css';
import { CalibrationScene } from './calibration/calibrationScene';
import { CalibrationStore } from './calibration/calibrationStore';
import { DebugPanel } from './debug/debugPanel';
import { Aiming, type AimState } from './game/aiming';
import { FaceTracker } from './tracking/faceTracker';
import { FrameBuffer } from './tracking/frameBuffer';
import type { DebugConfig, FaceFrame } from './types';

// Criado uma única vez e compartilhado por referência. O painel muta este objeto;
// os módulos leem os campos a cada frame.
const config: DebugConfig = {
  winkThreshold: 0.5,
  winkCounterThreshold: 0.25,
  winkMinFrames: 2,
  doubleBlinkThreshold: 0.5,
  minCutoff: 1.0,
  beta: 0.007,
  dCutoff: 1.0,
  preBlinkBufferMs: 180,
  snapRadius: 70,
  snapHysteresis: 25,
  headWeight: 0.65,
  headDeadzone: 3.0,
  eyeMaxOffset: 150,
  ridgeLambda: 0.001,
  cursorMinCutoff: 1.0,
  cursorBeta: 0.02,
};

const TRAIL_LENGTH = 12;

type Point = { x: number; y: number };

/** Conta eventos e expõe a taxa média do último ~1 s. */
class FpsCounter {
  private ticks: number[] = [];

  tick(now: number): void {
    this.ticks.push(now);
  }

  value(now: number): number {
    while (this.ticks.length > 0 && this.ticks[0] < now - 1000) this.ticks.shift();
    return this.ticks.length;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#main-canvas')!;
const ctx = canvas.getContext('2d')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;

const video = document.createElement('video');
video.muted = true;
video.playsInline = true;

const screenW = () => window.innerWidth;
const screenH = () => window.innerHeight;

const tracker = new FaceTracker(config);
const buffer = new FrameBuffer();
const store = new CalibrationStore(config);
store.load(screenW(), screenH());
const aiming = new Aiming(config, store);
const panel = new DebugPanel(config, video, {
  onRecalibrate: () => {
    statusEl.textContent = '';
    scene.start();
  },
  onClearCalibration: () => store.clear(),
});
const scene = new CalibrationScene(config, store, buffer, {
  setPanelCollapsed: (collapsed) => panel.setCollapsed(collapsed),
});

const trackingFps = new FpsCounter();
const rafFps = new FpsCounter();

let latestFrame: FaceFrame | null = null;
const trails: Record<'raw' | 'filtered' | 'delayed', (Point | null)[]> = {
  raw: [],
  filtered: [],
  delayed: [],
};

function pushTrail(trail: (Point | null)[], p: Point | null): void {
  trail.push(p);
  if (trail.length > TRAIL_LENGTH) trail.shift();
}

// ---------- Janela redimensionada invalida a calibração ----------

window.addEventListener('resize', () => {
  if (store.model && !store.checkScreen(screenW(), screenH())) {
    statusEl.textContent = store.invalidatedReason ?? '';
  }
  // Estande em andamento: as posições dos alvos mudaram, as amostras já coletadas não servem mais.
  if (scene.hidesCursor()) scene.start();
});

// ---------- Loop de tracking: um detect por frame novo da câmera ----------

function onVideoFrame(now: number): void {
  try {
    const frame = tracker.process(video, now);
    buffer.push(frame);
    latestFrame = frame;
    panel.pushFrame(frame);

    pushTrail(trails.raw, frame.gazeRaw);
    pushTrail(trails.filtered, frame.gazeFiltered);
    pushTrail(trails.delayed, buffer.getFrameAgo(config.preBlinkBufferMs)?.gazeFiltered ?? null);

    scene.onFrame(frame, screenW(), screenH());
    aiming.update(frame, screenW(), screenH(), scene.getTargets(screenW(), screenH()));

    trackingFps.tick(performance.now());
  } catch (err) {
    console.error('Erro no tracking', err);
  }
  video.requestVideoFrameCallback(onVideoFrame);
}

// ---------- Loop de render (tudo em px CSS) ----------

function resizeCanvas(): number {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(screenW() * dpr);
  const h = Math.round(screenH() * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}

/** Gaze do M0 [-1, 1] → px CSS. */
function gazeToScreen(p: Point): Point {
  return { x: ((p.x + 1) / 2) * screenW(), y: ((p.y + 1) / 2) * screenH() };
}

function drawTrail(trail: (Point | null)[], rgb: string): void {
  trail.forEach((p, i) => {
    if (!p) return;
    const age = (i + 1) / trail.length; // 1 = mais recente
    const isHead = i === trail.length - 1;
    const s = gazeToScreen(p);
    ctx.fillStyle = `rgba(${rgb}, ${isHead ? 1 : age * 0.45})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, isHead ? 9 : 2 + age * 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Contribuições de cabeça e olho (sem peso), cada uma a partir do centro. */
function drawContributions(aim: AimState): void {
  const cx = screenW() / 2;
  const cy = screenH() / 2;
  const mark = (offset: Point, color: string) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + offset.x, cy + offset.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx + offset.x, cy + offset.y, 6, 0, Math.PI * 2);
    ctx.fill();
  };
  mark(aim.headOffset, '#22d3ee');
  if (aim.eyeOffset) mark(aim.eyeOffset, '#e879f9');
}

/** Mira: anel com cruz. Grudado por snap: verde, maior e com os braços para dentro. */
function drawCursor(aim: AimState): void {
  const { x, y } = aim.cursor;
  const snapped = aim.snappedTargetId !== null;
  const color = snapped ? '#4ade80' : '#f8fafc';
  const r = snapped ? 22 : 16;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  const inner = snapped ? r * 0.35 : r * 0.55;
  const outer = snapped ? r * 0.9 : r * 1.6;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(x + dx * inner, y + dy * inner);
    ctx.lineTo(x + dx * outer, y + dy * outer);
  }
  ctx.stroke();
  ctx.restore();
}

function render(now: number): void {
  rafFps.tick(now);
  const dpr = resizeCanvas();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, screenW(), screenH());

  const aim = aiming.getState();
  scene.render(ctx, now, screenW(), screenH(), aim);

  if (!panel.isCollapsed()) {
    drawTrail(trails.delayed, '250, 204, 21'); // amarelo — gaze de preBlinkBufferMs atrás
    drawTrail(trails.raw, '239, 68, 68');      // vermelho — gaze cru
    drawTrail(trails.filtered, '59, 130, 246'); // azul — gaze filtrado (1€)
    if (aim) drawContributions(aim);
  }
  if (aim && !scene.hidesCursor()) drawCursor(aim);

  panel.render(now, latestFrame, tracker.getLandmarks(), trackingFps.value(now), rafFps.value(now), {
    status: store.status,
    model: store.model,
    invalidatedReason: store.invalidatedReason,
    lastDiscard: scene.lastDiscard,
    aim,
  });
  requestAnimationFrame(render);
}

// ---------- Boot ----------

async function openCamera(): Promise<MediaStream> {
  const base = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' };
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { ...base, frameRate: { ideal: 30, min: 25 } }, audio: false });
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'OverconstrainedError')) throw err;
    console.warn('A câmera não aceita frameRate mínimo de 25; abrindo sem mínimo.', err);
    return navigator.mediaDevices.getUserMedia({ video: base, audio: false });
  }
}

async function start(): Promise<void> {
  requestAnimationFrame(render);
  try {
    statusEl.textContent = 'Pedindo acesso à webcam…';
    video.srcObject = await openCamera();
    await video.play();

    statusEl.textContent = 'Carregando Face Landmarker…';
    await tracker.init();

    statusEl.textContent = store.invalidatedReason ?? '';
    if (store.model) scene.showFreeAim();
    else scene.start();
    video.requestVideoFrameCallback(onVideoFrame);
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Erro: ${err instanceof Error ? err.message : String(err)}`;
  }
}

start();
