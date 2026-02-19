function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class SfxManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.buffers = new Map();
    this.bufferPromises = new Map();
    this.activeNodes = 0;
  }

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {}
    }
    return this.ctx;
  }

  getContext() {
    return this.ctx;
  }

  getDestination() {
    return this.masterGain || this.ctx?.destination || null;
  }

  createGain(initial = 1) {
    if (!this.ctx) return null;
    const gain = this.ctx.createGain();
    gain.gain.value = clamp(Number(initial) || 1, 0, 1);
    gain.connect(this.getDestination());
    return gain;
  }

  async load(src) {
    if (!src) return null;
    const ctx = await this.ensureContext();
    if (!ctx) return null;
    if (this.buffers.has(src)) return this.buffers.get(src);
    if (!this.bufferPromises.has(src)) {
      const loadPromise = fetch(src)
        .then((res) => res.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => {
          this.buffers.set(src, buffer);
          this.bufferPromises.delete(src);
          return buffer;
        })
        .catch(() => {
          this.bufferPromises.delete(src);
          return null;
        });
      this.bufferPromises.set(src, loadPromise);
    }
    return this.bufferPromises.get(src);
  }

  async play(src, options = {}) {
    const buffer = await this.load(src);
    if (!buffer || !this.ctx) return false;
    const volume = clamp(Number(options.volume), 0, 1);
    const playbackRate = clamp(Number(options.playbackRate) || 1, 0.25, 4);
    const offset = clamp(Number(options.offset) || 0, 0, Math.max(0, buffer.duration - 0.01));
    const destination = options.destination || this.getDestination();
    const durationRaw = Number(options.duration);
    const duration = Number.isFinite(durationRaw)
      ? clamp(durationRaw, 0.01, Math.max(0.01, buffer.duration - offset))
      : null;
    try {
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      gain.gain.value = Number.isFinite(volume) ? volume : 1;
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;
      source.connect(gain);
      gain.connect(destination);
      this.activeNodes += 1;
      source.onended = () => {
        this.activeNodes = Math.max(0, this.activeNodes - 1);
      };
      if (duration != null) {
        source.start(0, offset, duration);
      } else {
        source.start(0, offset);
      }
      return true;
    } catch {
      return false;
    }
  }

  getDebugSnapshot() {
    return {
      state: this.ctx?.state || 'none',
      activeNodes: this.activeNodes,
      loadedBuffers: this.buffers.size,
    };
  }
}

const sfxManager = new SfxManager();

export default sfxManager;
