/**
 * Efeitos sonoros sintetizados com Web Audio (sem arquivos de áudio).
 *
 * Navegadores só deixam tocar som depois de um gesto do usuário (clique ou tecla). O jogo é
 * controlado pelo rosto, então `unlock()` é chamado no primeiro clique/tecla; antes disso os
 * sons são simplesmente ignorados. `toggleMute()` liga/desliga (tecla M).
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** O áudio já pode tocar? (false até o primeiro clique/tecla). */
  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch (err) {
      console.warn('[som] Web Audio indisponível', err);
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
    return this.muted;
  }

  shot(): void {
    this.noise(0.18, 1800, 0.9);
    this.tone('square', 140, 60, 0.12, 0.35);
  }

  empty(): void {
    this.tone('square', 900, 900, 0.03, 0.15);
  }

  reload(): void {
    this.tone('square', 420, 380, 0.05, 0.25);
    this.tone('square', 620, 560, 0.05, 0.25, 0.12);
  }

  switchWeapon(): void {
    this.tone('triangle', 520, 520, 0.06, 0.3);
    this.tone('triangle', 780, 780, 0.08, 0.3, 0.08);
  }

  hit(): void {
    this.tone('sawtooth', 700, 220, 0.12, 0.3);
    this.quack(0.05, 0.25);
  }

  armorBlock(): void {
    this.tone('square', 1500, 1300, 0.05, 0.2);
    this.tone('square', 1900, 1700, 0.06, 0.15, 0.05);
  }

  quack(delay = 0, volume = 0.35): void {
    this.tone('sawtooth', 520, 330, 0.09, volume, delay);
    this.tone('sawtooth', 480, 300, 0.11, volume, delay + 0.11);
  }

  superBlast(): void {
    this.noise(0.6, 600, 1);
    this.tone('sawtooth', 120, 900, 0.5, 0.35);
  }

  shieldOpen(): void {
    this.tone('sine', 300, 1200, 0.35, 0.35);
  }

  combo(level: number): void {
    this.tone('triangle', 660 + level * 60, 660 + level * 60, 0.07, 0.25);
  }

  star(): void {
    [660, 880, 1320].forEach((f, i) => this.tone('triangle', f, f, 0.12, 0.3, i * 0.12));
  }

  victory(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.14, 0.22, i * 0.13));
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + duration);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noise(duration: number, cutoff: number, volume: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || this.muted) return;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }
}

export const sfx = new Sfx();
