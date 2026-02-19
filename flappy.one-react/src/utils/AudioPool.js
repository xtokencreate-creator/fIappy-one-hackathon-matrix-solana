import sfxManager from '../audio/SfxManager';

export default class AudioPool {
  constructor(src, poolSize = 5, baseVolume = 1) {
    this.src = src;
    this.baseVolume = Math.max(0, Math.min(1, Number(baseVolume) || 1));
    this.poolSize = Math.max(1, Number(poolSize) || 1);
  }

  all() {
    return [];
  }

  async play(volume = this.baseVolume) {
    const targetVolume = Math.max(0, Math.min(1, Number(volume)));
    return sfxManager.play(this.src, { volume: targetVolume });
  }
}
