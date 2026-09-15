import type { CalibrationModel, CalibrationStatus } from '../calibration/calibrationStore';
import type { DiscardInfo } from '../calibration/calibrationScene';
import type { AimState } from '../game/aiming';
import type { DebugConfig, FaceFrame } from '../types';

const CHART_WINDOW_MS = 5000;
const IRIS_START = 468; // landmarks 468–477 são as duas íris

const SERIES = [
  { key: 'eyeBlinkLeft', color: '#22d3ee' },
  { key: 'eyeBlinkRight', color: '#fb923c' },
  { key: 'jawOpen', color: '#4ade80' },
  { key: 'browInnerUp', color: '#c084fc' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

const THRESHOLD_LINES: { key: keyof DebugConfig; color: string }[] = [
  { key: 'winkThreshold', color: '#f8fafc' },
  { key: 'winkCounterThreshold', color: '#94a3b8' },
  { key: 'doubleBlinkThreshold', color: '#facc15' },
];

/** log: o slider anda em log10(valor); min/max/step são então expoentes. */
const SLIDERS: { key: keyof DebugConfig; min: number; max: number; step: number; log?: boolean }[] = [
  { key: 'winkThreshold', min: 0, max: 1, step: 0.01 },
  { key: 'winkCounterThreshold', min: 0, max: 1, step: 0.01 },
  { key: 'winkMinFrames', min: 1, max: 10, step: 1 },
  { key: 'doubleBlinkThreshold', min: 0, max: 1, step: 0.01 },
  { key: 'minCutoff', min: 0.01, max: 5, step: 0.01 },
  { key: 'beta', min: 0, max: 1, step: 0.001 },
  { key: 'dCutoff', min: 0.1, max: 5, step: 0.1 },
  { key: 'preBlinkBufferMs', min: 0, max: 600, step: 10 },
  { key: 'snapRadius', min: 0, max: 200, step: 5 },
  { key: 'snapHysteresis', min: 0, max: 100, step: 5 },
  { key: 'headWeight', min: 0, max: 1, step: 0.01 },
  { key: 'headDeadzone', min: 0, max: 10, step: 0.5 },
  { key: 'eyeMaxOffset', min: 0, max: 600, step: 10 },
  { key: 'ridgeLambda', min: -6, max: 0, step: 0.1, log: true }, // 1e-6 … 1
  { key: 'cursorMinCutoff', min: 0.01, max: 5, step: 0.01 },
  { key: 'cursorBeta', min: 0, max: 1, step: 0.001 },
];

export interface CalibrationPanelInfo {
  status: CalibrationStatus;
  model: CalibrationModel | null;
  invalidatedReason: string | null;
  lastDiscard: DiscardInfo | null;
  aim: AimState | null;
}

export interface DebugPanelActions {
  onRecalibrate(): void;
  onClearCalibration(): void;
}

interface ChartSample {
  t: number;
  values: Record<SeriesKey, number>;
}

export class DebugPanel {
  private readonly root: HTMLDivElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private readonly videoWrap: HTMLDivElement;
  private readonly chart: HTMLCanvasElement;
  private readonly chartCtx: CanvasRenderingContext2D;
  private readonly poseEl: HTMLDivElement;
  private readonly fpsEl: HTMLDivElement;
  private readonly leds: Record<string, HTMLSpanElement> = {};
  private readonly faceEl: HTMLDivElement;
  private readonly calibStatusEl: HTMLDivElement;
  private readonly calibWarnEl: HTMLDivElement;
  private readonly calibDiscardEl: HTMLDivElement;
  private readonly calibErrorEl: HTMLDivElement;
  private readonly residualCells: HTMLDivElement[] = [];
  private readonly calibHeadEl: HTMLDivElement;
  private readonly samples: ChartSample[] = [];

  constructor(
    private readonly config: DebugConfig,
    private readonly video: HTMLVideoElement,
    actions: DebugPanelActions,
  ) {
    this.root = el('div', 'debug-panel');

    // 1. Vídeo + landmarks
    this.videoWrap = el('div', 'video-wrap');
    this.overlay = document.createElement('canvas');
    this.overlay.width = 320;
    this.overlay.height = 240;
    this.overlayCtx = this.overlay.getContext('2d')!;
    video.classList.add('debug-video');
    this.videoWrap.append(video, this.overlay);
    this.root.append(section('Webcam', this.videoWrap));

    // 2. Gráfico dos blendshapes
    this.chart = document.createElement('canvas');
    this.chart.width = 320;
    this.chart.height = 150;
    this.chart.className = 'chart';
    this.chartCtx = this.chart.getContext('2d')!;
    const legend = el('div', 'legend');
    for (const s of SERIES) legend.append(swatch(s.color, s.key, false));
    for (const t of THRESHOLD_LINES) legend.append(swatch(t.color, t.key, true));
    this.root.append(section('Blendshapes (5 s)', this.chart, legend));

    // 3. Pose da cabeça
    this.poseEl = el('div', 'readout');
    this.root.append(section('Head pose', this.poseEl));

    // 4. Sliders
    const sliders = el('div', 'sliders');
    for (const def of SLIDERS) sliders.append(this.buildSlider(def));
    this.root.append(section('DebugConfig', sliders));

    // 5. FPS
    this.fpsEl = el('div', 'readout');
    this.root.append(section('FPS', this.fpsEl));

    // 6. LEDs
    const ledRow = el('div', 'leds');
    for (const name of ['winkLeft', 'winkRight', 'bothClosed', 'jawOpen > 0.5', 'browInnerUp > 0.5']) {
      const item = el('div', 'led-item');
      const led = el('span', 'led');
      item.append(led, document.createTextNode(name));
      ledRow.append(item);
      this.leds[name] = led;
    }
    this.root.append(section('Eventos', ledRow));

    // 7. Rosto detectado
    this.faceEl = el('div', 'face-indicator');
    this.root.append(section('Rosto', this.faceEl));

    // Calibração
    this.calibStatusEl = el('div', 'readout');
    this.calibWarnEl = el('div', 'calib-warn');
    this.calibDiscardEl = el('div', 'calib-discard');
    this.calibErrorEl = el('div', 'readout');
    const residualGrid = el('div', 'residual-grid');
    for (let i = 0; i < 9; i++) {
      const cell = el('div', 'residual-cell');
      residualGrid.append(cell);
      this.residualCells.push(cell);
    }
    this.calibHeadEl = el('div', 'readout');
    const canvasLegend = el('div', 'legend');
    canvasLegend.append(dot('#22d3ee', 'cabeça (sem peso)'), dot('#e879f9', 'olho (sem peso)'), dot('#f8fafc', 'cursor final'));
    const recalibrateBtn = el('button', 'panel-btn');
    recalibrateBtn.textContent = 'Recalibrar';
    recalibrateBtn.addEventListener('click', () => actions.onRecalibrate());
    const clearBtn = el('button', 'panel-btn');
    clearBtn.textContent = 'Limpar calibração';
    clearBtn.addEventListener('click', () => actions.onClearCalibration());
    const btnRow = el('div', 'btn-row');
    btnRow.append(recalibrateBtn, clearBtn);
    this.root.append(
      section('Calibração', this.calibStatusEl, this.calibWarnEl, this.calibDiscardEl, this.calibErrorEl, residualGrid, this.calibHeadEl, canvasLegend, btnRow),
    );

    // 8. Export
    const exportBtn = el('button', 'export-btn');
    exportBtn.textContent = 'Export Config';
    exportBtn.addEventListener('click', () => this.exportConfig(exportBtn));
    this.root.append(exportBtn);

    document.body.append(this.root);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') this.root.classList.toggle('collapsed');
    });
  }

  /** Chamado a cada frame de tracking: guarda a amostra do gráfico. */
  pushFrame(frame: FaceFrame): void {
    const b = frame.blendshapes;
    this.samples.push({
      t: frame.timestamp,
      values: {
        eyeBlinkLeft: b.eyeBlinkLeft ?? 0,
        eyeBlinkRight: b.eyeBlinkRight ?? 0,
        jawOpen: b.jawOpen ?? 0,
        browInnerUp: b.browInnerUp ?? 0,
      },
    });
  }

  /** Chamado a cada requestAnimationFrame. */
  render(
    now: number,
    frame: FaceFrame | null,
    landmarks: ReadonlyArray<{ x: number; y: number }> | null,
    trackingFps: number,
    rafFps: number,
    calib: CalibrationPanelInfo,
  ): void {
    this.drawLandmarks(landmarks);
    this.drawChart(now);

    const pose = frame?.headPose;
    this.poseEl.textContent = pose
      ? `yaw ${fmtDeg(pose.yaw)}   pitch ${fmtDeg(pose.pitch)}   roll ${fmtDeg(pose.roll)}`
      : 'yaw —   pitch —   roll —';

    this.fpsEl.textContent = `tracking ${trackingFps.toFixed(1)}   ·   rAF ${rafFps.toFixed(1)}`;

    const b = frame?.blendshapes ?? {};
    setLed(this.leds['winkLeft'], !!frame?.eyeState.winkLeft);
    setLed(this.leds['winkRight'], !!frame?.eyeState.winkRight);
    setLed(this.leds['bothClosed'], !!frame?.eyeState.bothClosed);
    setLed(this.leds['jawOpen > 0.5'], (b.jawOpen ?? 0) > 0.5);
    setLed(this.leds['browInnerUp > 0.5'], (b.browInnerUp ?? 0) > 0.5);

    const detected = !!frame?.faceDetected;
    this.faceEl.classList.toggle('detected', detected);
    this.faceEl.textContent = detected ? 'detectado' : 'não detectado';

    this.renderCalibration(calib);
  }

  isCollapsed(): boolean {
    return this.root.classList.contains('collapsed');
  }

  setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle('collapsed', collapsed);
  }

  private renderCalibration(calib: CalibrationPanelInfo): void {
    const statusText = { absent: 'ausente', loaded: 'carregado do localStorage', trained: 'recém-treinado' }[calib.status];
    this.calibStatusEl.textContent = `modelo: ${statusText}`;

    const warn = calib.invalidatedReason ?? (calib.model ? '' : 'Sem calibração: cursor usa só a cabeça.');
    this.calibWarnEl.textContent = warn;

    const d = calib.lastDiscard;
    this.calibDiscardEl.textContent = d ? `amostra descartada (alvo ${d.pointIndex + 1}): ${d.reason}` : '';

    const m = calib.model;
    this.calibErrorEl.textContent = m ? `erro médio ${m.meanResidual.toFixed(0)} px   (resíduos LOO por alvo ↓)` : 'erro médio —';
    this.residualCells.forEach((cell, i) => {
      const r = m?.residuals[i];
      cell.textContent = r !== undefined && Number.isFinite(r) ? `${i + 1}: ${r.toFixed(0)}` : `${i + 1}: —`;
      cell.classList.toggle('bad', r !== undefined && r > 150);
    });

    const b = m?.headBaseline;
    const hd = calib.aim?.headDelta;
    this.calibHeadEl.textContent =
      `baseline  ${b ? `${fmtDeg(b.yaw)} ${fmtDeg(b.pitch)} ${fmtDeg(b.roll)}` : '—'}
` +
      `delta     ${hd ? `${fmtDeg(hd.yaw)} ${fmtDeg(hd.pitch)} ${fmtDeg(hd.roll)}` : '—'}`;
  }

  private buildSlider(def: (typeof SLIDERS)[number]): HTMLElement {
    const row = el('label', 'slider-row');
    const head = el('div', 'slider-head');
    const name = el('span', 'slider-name');
    name.textContent = def.key;
    const value = el('span', 'slider-value');
    head.append(name, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    const decimals = decimalsOf(def.step);
    const format = (v: number) => (def.log ? v.toExponential(1) : v.toFixed(decimals));
    input.value = String(def.log ? Math.log10(this.config[def.key]) : this.config[def.key]);
    value.textContent = format(this.config[def.key]);

    input.addEventListener('input', () => {
      // Muta o objeto compartilhado: os módulos leem o novo valor no próximo frame.
      this.config[def.key] = def.log ? 10 ** Number(input.value) : Number(input.value);
      value.textContent = format(this.config[def.key]);
    });

    row.append(head, input);
    return row;
  }

  private drawLandmarks(landmarks: ReadonlyArray<{ x: number; y: number }> | null): void {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (vw > 0 && vh > 0) {
      const h = Math.round((320 * vh) / vw);
      if (this.overlay.height !== h) {
        this.overlay.height = h;
        this.videoWrap.style.height = `${h}px`;
      }
    }

    const ctx = this.overlayCtx;
    const w = this.overlay.width;
    const h = this.overlay.height;
    ctx.clearRect(0, 0, w, h);
    if (!landmarks) return;

    ctx.fillStyle = 'rgba(74, 222, 128, 0.75)';
    for (let i = 0; i < Math.min(IRIS_START, landmarks.length); i++) {
      ctx.fillRect(landmarks[i].x * w - 0.75, landmarks[i].y * h - 0.75, 1.5, 1.5);
    }
    ctx.fillStyle = '#ff3df2';
    for (let i = IRIS_START; i < landmarks.length; i++) {
      ctx.beginPath();
      ctx.arc(landmarks[i].x * w, landmarks[i].y * h, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawChart(now: number): void {
    const start = now - CHART_WINDOW_MS;
    while (this.samples.length > 0 && this.samples[0].t < start - 200) this.samples.shift();

    const ctx = this.chartCtx;
    const w = this.chart.width;
    const h = this.chart.height;
    const pad = 4;
    const yOf = (v: number) => pad + (1 - v) * (h - 2 * pad);
    const xOf = (t: number) => ((t - start) / CHART_WINDOW_MS) * w;

    ctx.clearRect(0, 0, w, h);

    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const line of THRESHOLD_LINES) {
      const y = yOf(this.config[line.key]);
      ctx.strokeStyle = line.color;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.lineWidth = 1.5;
    for (const s of SERIES) {
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      this.samples.forEach((sample, i) => {
        const x = xOf(sample.t);
        const y = yOf(sample.values[s.key]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  private async exportConfig(button: HTMLButtonElement): Promise<void> {
    const json = JSON.stringify(this.config, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      flash(button, 'Copiado!');
    } catch (err) {
      console.error('Falha ao copiar config', err, json);
      flash(button, 'Falhou (veja o console)');
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const s = el('section', 'panel-section');
  const h = el('h3', 'panel-title');
  h.textContent = title;
  s.append(h, ...children);
  return s;
}

function swatch(color: string, label: string, dashed: boolean): HTMLElement {
  const item = el('span', 'legend-item');
  const mark = el('span', dashed ? 'legend-mark dashed' : 'legend-mark');
  mark.style.borderColor = color;
  item.append(mark, document.createTextNode(label));
  return item;
}

function dot(color: string, label: string): HTMLElement {
  const item = el('span', 'legend-item');
  const mark = el('span', 'legend-dot');
  mark.style.background = color;
  item.append(mark, document.createTextNode(label));
  return item;
}

function setLed(led: HTMLSpanElement, on: boolean): void {
  led.classList.toggle('on', on);
}

function fmtDeg(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`;
}

function decimalsOf(step: number): number {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function flash(button: HTMLButtonElement, text: string): void {
  button.textContent = text;
  setTimeout(() => (button.textContent = 'Export Config'), 1200);
}
