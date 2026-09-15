import type { AimState } from '../game/aiming';
import type { DebugConfig, FaceFrame } from '../types';
import { ButtonScene, drawText, roundRect, type UiButton } from './menuScene';

export interface SetupSources {
  video: HTMLVideoElement;
  landmarks(): ReadonlyArray<{ x: number; y: number }> | null;
  trackingFps(): number;
}

type CheckLevel = 'ok' | 'warn' | 'bad';
interface Check {
  level: CheckLevel;
  text: string;
}

// Landmarks do MediaPipe usados para posição e distância.
const NOSE_TIP = 1;
const FACE_LEFT = 234;
const FACE_RIGHT = 454;

/** Largura do rosto (fração da largura do vídeo) considerada boa: nem longe, nem perto demais. */
const FACE_WIDTH_MIN = 0.14;
const FACE_WIDTH_MAX = 0.42;
/** Brilho médio (0–255) abaixo disso = ambiente escuro, landmarks tremem e o FPS cai. */
const DARK_LUMA = 55;
const MIN_FPS = 20;
const BRIGHTNESS_EVERY_MS = 500;

/**
 * Primeira vez guiada, passo "prepare-se": mostra a câmera e confere rosto, posição,
 * distância, luz, FPS e tela cheia antes do Estande. Só o rosto detectado é obrigatório.
 */
export class SetupScene extends ButtonScene {
  private frame: FaceFrame | null = null;
  private brightness: number | null = null;
  private brightnessAt = -Infinity;
  private readonly sampler = document.createElement('canvas');

  constructor(
    config: DebugConfig,
    private readonly sources: SetupSources,
    private readonly onContinue: () => void,
  ) {
    super(config);
    this.sampler.width = 32;
    this.sampler.height = 18;
  }

  onFrame(frame: FaceFrame, aim: AimState | null, w: number, h: number): void {
    this.frame = frame;
    super.onFrame(frame, aim, w, h);
  }

  protected layout(w: number, h: number): UiButton[] {
    const ready = !!this.frame?.faceDetected;
    return [
      {
        id: 'calibrate',
        x: w / 2 - 160,
        y: h - 110,
        w: 320,
        h: 64,
        primary: true,
        enabled: ready,
        label: ready ? 'Tudo certo, calibrar a mira' : 'Aguardando seu rosto...',
        onSelect: this.onContinue,
      },
    ];
  }

  protected drawContent(ctx: CanvasRenderingContext2D, now: number, w: number, h: number): void {
    drawText(ctx, w / 2, h * 0.06, 'Prepare-se', 36, '#f8fafc');
    drawText(ctx, w / 2, h * 0.06 + 36, 'Sente-se de frente para a tela, com luz no rosto', 17, '#94a3b8');

    const video = this.sources.video;
    const aspect = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 9 / 16;
    const wide = w >= 900;
    const top = h * 0.06 + 70;
    const checksW = Math.min(440, wide ? w * 0.4 : w - 48);
    const maxPreviewH = wide ? h - top - 140 : (h - top - 140) * 0.45;
    const previewW = Math.max(160, Math.min(wide ? 560 : 440, wide ? w * 0.42 : w - 48, maxPreviewH / aspect));
    const previewH = previewW * aspect;
    const previewX = wide ? w / 2 - (previewW + 32 + checksW) / 2 : w / 2 - previewW / 2;
    const checksX = wide ? previewX + previewW + 32 : w / 2 - checksW / 2;
    const checksY = wide ? top : top + previewH + 10;

    this.drawPreview(ctx, previewX, top, previewW, previewH);
    this.sampleBrightness(now);

    const checks = this.checks(w, h);
    const lineH = wide ? 38 : 30;
    checks.forEach((c, i) => {
      const y = checksY + 20 + i * lineH;
      const icon = c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✗';
      const color = c.level === 'ok' ? '#4ade80' : c.level === 'warn' ? '#fbbf24' : '#f87171';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(checksX + 12, y, 11, 0, Math.PI * 2);
      ctx.fill();
      drawText(ctx, checksX + 12, y + 1, icon, 14, '#0b1324');
      drawText(ctx, checksX + 34, y, c.text, 16, c.level === 'ok' ? '#e2e8f0' : color, 'left');
    });

    const closed = !!this.frame?.faceDetected && this.frame.eyeState.bothClosed;
    const testY = checksY + 20 + checks.length * lineH + 6;
    drawText(ctx, checksX, testY, 'Teste: feche os dois olhos', 16, '#94a3b8', 'left');
    ctx.fillStyle = closed ? '#4ade80' : 'rgba(71, 85, 105, 0.8)';
    ctx.beginPath();
    ctx.arc(checksX + 232, testY, 9, 0, Math.PI * 2);
    ctx.fill();
    if (closed) drawText(ctx, checksX + 250, testY, 'detectado', 16, '#4ade80', 'left');
  }

  private checks(w: number, h: number): Check[] {
    const frame = this.frame;
    const lm = this.sources.landmarks();
    const list: Check[] = [];
    if (!frame?.faceDetected || !lm) {
      list.push({ level: 'bad', text: 'Rosto não encontrado: olhe para a câmera' });
    } else {
      list.push({ level: 'ok', text: 'Rosto encontrado' });
      const nose = lm[NOSE_TIP];
      const centered = nose.x > 0.3 && nose.x < 0.7 && nose.y > 0.2 && nose.y < 0.75;
      list.push(centered ? { level: 'ok', text: 'Rosto centralizado' } : { level: 'warn', text: 'Centralize o rosto na imagem' });
      const faceW = Math.abs(lm[FACE_RIGHT].x - lm[FACE_LEFT].x);
      list.push(
        faceW < FACE_WIDTH_MIN
          ? { level: 'warn', text: 'Chegue um pouco mais perto' }
          : faceW > FACE_WIDTH_MAX
            ? { level: 'warn', text: 'Afaste-se um pouco da câmera' }
            : { level: 'ok', text: 'Boa distância' },
      );
      const { yaw, roll } = frame.headPose;
      list.push(
        Math.abs(yaw) < 15 && Math.abs(roll) < 10
          ? { level: 'ok', text: 'Cabeça de frente e reta' }
          : { level: 'warn', text: 'Olhe de frente, com a cabeça reta' },
      );
    }
    if (this.brightness !== null) {
      list.push(
        this.brightness < DARK_LUMA
          ? { level: 'warn', text: 'Ambiente escuro: acenda uma luz de frente' }
          : { level: 'ok', text: 'Iluminação boa' },
      );
    }
    const fps = this.sources.trackingFps();
    list.push(
      fps < MIN_FPS
        ? { level: 'warn', text: `Câmera lenta (${fps} FPS): mais luz costuma ajudar` }
        : { level: 'ok', text: `Câmera fluida (${fps} FPS)` },
    );
    const fullscreen = !!document.fullscreenElement || (h >= screen.height - 4 && w >= screen.width - 4);
    list.push(fullscreen ? { level: 'ok', text: 'Tela cheia' } : { level: 'warn', text: 'Aperte F11 para tela cheia antes de calibrar' });
    return list;
  }

  private drawPreview(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const video = this.sources.video;
    ctx.save();
    roundRect(ctx, x, y, w, h, 14);
    ctx.fillStyle = '#020617';
    ctx.fill();
    ctx.clip();
    if (video.videoWidth > 0) {
      // Espelhado: mexer para a direita mexe a imagem para a direita.
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      const lm = this.sources.landmarks();
      if (lm && this.frame?.faceDetected) {
        let minX = 1;
        let maxX = 0;
        let minY = 1;
        let maxY = 0;
        for (const p of lm) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 3;
        roundRect(ctx, minX * w, minY * h, (maxX - minX) * w, (maxY - minY) * h, 10);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.save();
    roundRect(ctx, x, y, w, h, 14);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  private sampleBrightness(now: number): void {
    const video = this.sources.video;
    if (video.videoWidth === 0 || now - this.brightnessAt < BRIGHTNESS_EVERY_MS) return;
    this.brightnessAt = now;
    const sctx = this.sampler.getContext('2d', { willReadFrequently: true });
    if (!sctx) return;
    sctx.drawImage(video, 0, 0, this.sampler.width, this.sampler.height);
    const data = sctx.getImageData(0, 0, this.sampler.width, this.sampler.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    this.brightness = sum / (data.length / 4);
  }
}
