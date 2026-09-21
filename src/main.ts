import './style.css';
import { CalibrationScene } from './calibration/calibrationScene';
import { CalibrationStore } from './calibration/calibrationStore';
import { DebugPanel } from './debug/debugPanel';
import { Aiming, type AimState } from './game/aiming';
import { CareerStore } from './career/careerStore';
import { dailyChallenge } from './career/daily';
import { evaluateMission, missionById, regionById } from './career/missions';
import { COMPLETION_HOOKS } from './career/story';
import { ARCADE_ROUNDS, DuckGame, type GameSetup, type GameStats } from './game/duckGame';
import { sfx } from './game/sound';
import { AchievementsScene } from './scenes/achievementsScene';
import { ArsenalScene } from './scenes/arsenalScene';
import { BriefingScene } from './scenes/briefingScene';
import { MapScene } from './scenes/mapScene';
import { MenuScene, type ButtonScene, type Nav } from './scenes/menuScene';
import { ResultScene } from './scenes/resultScene';
import { SettingsScene } from './scenes/settingsScene';
import { SetupScene } from './scenes/setupScene';
import { WelcomeScene } from './scenes/welcomeScene';
import { DEFAULT_CONFIG, restoreDefaultConfig, saveConfig } from './settings/configStore';
import { isOnboardingDone, markOnboardingDone } from './settings/onboarding';
import { FaceTracker } from './tracking/faceTracker';
import { FrameBuffer } from './tracking/frameBuffer';
import type { DebugConfig, FaceFrame } from './types';

// Criado uma única vez e compartilhado por referência. O painel e as Configurações mutam este
// objeto; os módulos leem os campos a cada frame.
// O painel aplica por cima os valores salvos pelo jogador (localStorage) antes de qualquer módulo ler.
const config: DebugConfig = { ...DEFAULT_CONFIG };

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
const career = new CareerStore();
career.load();

// ---------- Cenas e navegação ----------

type SceneId =
  | 'welcome'
  | 'setup'
  | 'calibration'
  | 'menu'
  | 'map'
  | 'briefing'
  | 'arsenal'
  | 'achievements'
  | 'settings'
  | 'result'
  | 'game';
/** Cena ativa: boas-vindas/carregamento, preparo, calibração (Estande / mira livre), telas de menu ou a partida. */
let activeScene: SceneId = 'welcome';

const game = new DuckGame(config, (stats, setup) => onGameFinished(stats, setup));

const panel = new DebugPanel(config, video, {
  onRecalibrate: () => nav.recalibrate(),
  onClearCalibration: () => store.clear(),
});

const nav: Nav = {
  menu: () => goto('menu'),
  map: () => goto('map'),
  briefing: (missionId) => {
    briefingScene.show(missionId);
    goto('briefing');
  },
  arsenal: (returnTo) => {
    arsenalScene.show(returnTo);
    goto('arsenal');
  },
  startMission: (missionId) => {
    const mission = missionById(missionId);
    if (!mission) return;
    const region = regionById(mission.region);
    const first = mission.objectives[0];
    game.start({
      mode: 'mission',
      title: `${region.name} · Missão ${mission.index + 1}`,
      rounds: [mission.round],
      environment: region.environment,
      weapons: career.loadout(),
      tutorial: mission.tutorial,
      goalHits: first.kind === 'hits' ? first.value : undefined,
      missionId: mission.id,
    });
    goto('game');
  },
  startArcade: () => {
    game.start({ mode: 'arcade', title: 'Treino Livre', rounds: ARCADE_ROUNDS, environment: 'lake', weapons: career.loadout() });
    goto('game');
  },
  startDaily: () => {
    const daily = dailyChallenge();
    game.start({ mode: 'daily', title: `Desafio Diário · ${daily.environmentName}`, rounds: [daily.round], environment: daily.environment, weapons: career.loadout() });
    goto('game');
  },
  achievements: () => goto('achievements'),
  settings: () => goto('settings'),
  freeAim: () => {
    scene.showFreeAim();
    goto('calibration');
  },
  recalibrate: () => {
    statusEl.textContent = '';
    goto('calibration');
    scene.start();
  },
};

const scene = new CalibrationScene(store, buffer, {
  // Na primeira vez guiada o painel técnico não abre sozinho no resultado do Estande.
  setPanelCollapsed: (collapsed) => {
    if (collapsed || isOnboardingDone()) panel.setCollapsed(collapsed);
  },
  startGame: () => nav.menu(),
  recenter: (x, y) => aiming.recenter(x, y),
  afterResults: () => {
    if (isOnboardingDone() || !store.model) return false;
    // Primeira vez guiada: do Estande direto para a missão tutorial do Lago.
    markOnboardingDone();
    nav.briefing('lago-1');
    return true;
  },
});
const welcomeScene = new WelcomeScene(config, () => void boot());
const setupScene = new SetupScene(
  config,
  { video, landmarks: () => tracker.getLandmarks(), trackingFps: () => trackingFps.value(performance.now()) },
  () => nav.recalibrate(),
);
const settingsScene = new SettingsScene(config, nav, {
  onChanged: () => {
    saveConfig(config);
    panel.refreshSliders();
  },
  onRestoreDefaults: () => {
    restoreDefaultConfig(config);
    panel.refreshSliders();
  },
});
const menuScene = new MenuScene(config, career, nav, () =>
  store.invalidatedReason ? 'A janela mudou de tamanho e a calibração foi apagada: use Recalibrar' : null,
);
const mapScene = new MapScene(config, career, nav);
const briefingScene = new BriefingScene(config, career, nav);
const arsenalScene = new ArsenalScene(config, career);
const resultScene = new ResultScene(config, nav);
const achievementsScene = new AchievementsScene(config, career, nav);
const buttonScenes: Partial<Record<SceneId, ButtonScene>> = {
  welcome: welcomeScene,
  setup: setupScene,
  settings: settingsScene,
  menu: menuScene,
  map: mapScene,
  briefing: briefingScene,
  arsenal: arsenalScene,
  result: resultScene,
  achievements: achievementsScene,
};

function goto(id: SceneId): void {
  if (activeScene === 'game' && id !== 'game') game.stop();
  activeScene = id;
  if (id !== 'calibration') panel.setCollapsed(true);
  buttonScenes[id]?.enter();
}

function onGameFinished(stats: GameStats, setup: GameSetup): void {
  if (setup.mode === 'arcade') {
    const achievements = career.recordGame(stats, setup);
    resultScene.show({ kind: 'arcade', stats, record: Math.max(Math.round(stats.score), arcadeRecord()), achievements });
  } else if (setup.mode === 'daily') {
    const daily = dailyChallenge();
    const { penas, best, newBest } = career.recordDaily(daily.date, Math.round(stats.score), stats.hits);
    const achievements = career.recordGame(stats, setup);
    resultScene.show({ kind: 'daily', stats, best, newBest, penas, placeName: daily.environmentName, achievements });
  } else {
    const mission = missionById(setup.missionId ?? '')!;
    const wasCompleted = career.starsOf(mission.id) > 0;
    const achieved = evaluateMission(mission, stats);
    const reward = career.recordResult(mission, achieved, stats.hits);
    const achievements = career.recordGame(stats, setup, achieved);
    const hook = !wasCompleted && achieved[0] ? (COMPLETION_HOOKS[mission.id] ?? []) : [];
    if (reward.newStars > 0) sfx.star();
    resultScene.show({ kind: 'mission', mission, stats, achieved, reward, hook, achievements });
  }
  goto('result');
}

function arcadeRecord(): number {
  try {
    return Number(localStorage.getItem('duck-of-duty.record.v1')) || 0;
  } catch {
    return 0;
  }
}

window.addEventListener('keydown', (e) => {
  // Som: navegadores só liberam áudio depois de um gesto; M liga/desliga.
  sfx.unlock();
  if (e.key === 'm' || e.key === 'M') sfx.toggleMute();
  // Tecla C na mira livre: recentralizar olhando o alvo do centro.
  if ((e.key === 'c' || e.key === 'C') && activeScene === 'calibration') scene.recenterOnCenter(screenW(), screenH());
  // Esc abandona a partida: missão volta ao mapa, Treino Livre volta ao menu.
  if (e.key === 'Escape' && activeScene === 'game') {
    if (game.getSetup()?.mode === 'mission') nav.map();
    else nav.menu();
  }
});

// Clique do mouse nas telas de menu.
canvas.addEventListener('click', (e) => {
  sfx.unlock();
  buttonScenes[activeScene]?.onClick(e.clientX, e.clientY, screenW(), screenH());
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
  if (activeScene === 'calibration' && scene.hidesCursor()) scene.start();
});

// ---------- Loop de tracking: um detect por frame novo da câmera ----------

/** Identificador do callback de frame pendente, para cancelar ao trocar de câmera (evita dois loops). */
let frameCallbackHandle = 0;

function scheduleNextFrame(): void {
  frameCallbackHandle = video.requestVideoFrameCallback(onVideoFrame);
}

function onVideoFrame(now: number): void {
  try {
    const frame = tracker.process(video, now);
    buffer.push(frame);
    latestFrame = frame;
    panel.pushFrame(frame);

    pushTrail(trails.raw, frame.gazeRaw);
    pushTrail(trails.filtered, frame.gazeFiltered);
    pushTrail(trails.delayed, buffer.getFrameAgo(config.preBlinkBufferMs)?.gazeFiltered ?? null);

    const aim = aiming.update(frame, screenW(), screenH(), currentTargets());
    const buttons = buttonScenes[activeScene];
    if (activeScene === 'game') game.onFrame(frame, aim);
    else if (activeScene === 'calibration') scene.onFrame(frame, screenW(), screenH());
    else buttons?.onFrame(frame, aim, screenW(), screenH());

    trackingFps.tick(performance.now());
  } catch (err) {
    console.error('Erro no tracking', err);
  }
  scheduleNextFrame();
}

function currentTargets() {
  if (activeScene === 'game') return game.getTargets();
  if (activeScene === 'calibration') return scene.getTargets(screenW(), screenH());
  return [];
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

/** Contribuições de cabeça e olho (as parcelas da soma), cada uma a partir do centro. */
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

  let aim = aiming.getState();
  if (aim?.snappedTargetId) {
    const live = currentTargets().find((tg) => tg.id === aim!.snappedTargetId);
    if (live) aim = { ...aim, cursor: { x: live.x, y: live.y } };
  }
  // Telas de menu: a mira travada num botão aparece presa no centro dele, verde.
  const buttonLock = aim ? buttonScenes[activeScene]?.lockedCursor(screenW(), screenH()) : null;
  if (aim && buttonLock) aim = { ...aim, cursor: buttonLock, snappedTargetId: 'button' };
  if (activeScene === 'game') game.render(ctx, now, screenW(), screenH(), aim);
  else if (activeScene === 'calibration') scene.render(ctx, now, screenW(), screenH(), aim);
  else buttonScenes[activeScene]?.render(ctx, now, screenW(), screenH());

  if (!panel.isCollapsed()) {
    drawTrail(trails.delayed, '250, 204, 21'); // amarelo — gaze de preBlinkBufferMs atrás
    drawTrail(trails.raw, '239, 68, 68');      // vermelho — gaze cru
    drawTrail(trails.filtered, '59, 130, 246'); // azul — gaze filtrado (1€)
    if (aim) drawContributions(aim);
  }
  if (aim && (activeScene !== 'calibration' || !scene.hidesCursor())) drawCursor(aim);

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

/** Resoluções tentadas, da melhor para a mais leve. Mais pixels nos olhos = landmarks menos tremidos. */
const CAMERA_RESOLUTIONS = [
  { width: 1280, height: 720 },
  { width: 640, height: 480 },
];
/** Abaixo disso, depois de estabilizar, a resolução alta é trocada pela seguinte. */
const MIN_TRACKING_FPS = 25;
const FPS_CHECK_DELAY_MS = 4000;

async function openCamera(resolution: { width: number; height: number }): Promise<MediaStream> {
  const base = { width: { ideal: resolution.width }, height: { ideal: resolution.height }, facingMode: 'user' };
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { ...base, frameRate: { ideal: 30, min: 25 } }, audio: false });
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'OverconstrainedError')) throw err;
    console.warn('A câmera não aceita frameRate mínimo de 25; abrindo sem mínimo.', err);
    return navigator.mediaDevices.getUserMedia({ video: base, audio: false });
  }
}

async function useCamera(index: number): Promise<void> {
  (video.srcObject as MediaStream | null)?.getTracks().forEach((track) => track.stop());
  video.srcObject = await openCamera(CAMERA_RESOLUTIONS[index]);
  await video.play();
}

/**
 * Começa na resolução mais alta; se o tracking não sustentar MIN_TRACKING_FPS, desce um nível.
 * A resolução em uso aparece no painel, ao lado do FPS.
 */
function scheduleFpsCheck(index: number): void {
  if (index >= CAMERA_RESOLUTIONS.length - 1) return;
  setTimeout(async () => {
    const fps = trackingFps.value(performance.now());
    if (fps >= MIN_TRACKING_FPS) return;
    const next = CAMERA_RESOLUTIONS[index + 1];
    console.warn(`[câmera] tracking a ${fps} FPS em ${video.videoWidth}×${video.videoHeight}; trocando para ${next.width}×${next.height}.`);
    try {
      video.cancelVideoFrameCallback(frameCallbackHandle);
      await useCamera(index + 1);
      scheduleNextFrame();
      scheduleFpsCheck(index + 1);
    } catch (err) {
      console.error('[câmera] falha ao trocar de resolução', err);
    }
  }, FPS_CHECK_DELAY_MS);
}

let trackerReady = false;
let booting = false;

/** Abre a câmera e carrega o detector; em caso de erro a tela de boas-vindas mostra o que fazer. */
async function boot(): Promise<void> {
  if (booting) return;
  booting = true;
  goto('welcome');
  try {
    if (!video.srcObject) {
      welcomeScene.showLoading('Pedindo acesso à câmera');
      await useCamera(0);
    }
    if (!trackerReady) {
      welcomeScene.showLoading('Carregando o detector de rosto');
      await tracker.init();
      trackerReady = true;
    }

    statusEl.textContent = store.invalidatedReason ?? '';
    if (store.model) {
      nav.menu();
    } else if (!isOnboardingDone()) {
      goto('setup');
    } else {
      goto('calibration');
      scene.start();
    }
    scheduleNextFrame();
    scheduleFpsCheck(0);
  } catch (err) {
    console.error(err);
    // Câmera que abriu mas falhou depois: fecha para a próxima tentativa abrir de novo.
    if (!trackerReady) {
      (video.srcObject as MediaStream | null)?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
    welcomeScene.showError(err);
  } finally {
    booting = false;
  }
}

function start(): void {
  requestAnimationFrame(render);
  // Quem já calibrou ou tem progresso não passa pela primeira vez guiada.
  if (!isOnboardingDone() && (store.model || store.invalidatedReason || career.totalStars() > 0)) markOnboardingDone();
  if (isOnboardingDone()) {
    void boot();
  } else {
    welcomeScene.showIntro();
    goto('welcome');
  }
}

start();
