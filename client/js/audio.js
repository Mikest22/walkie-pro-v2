export class AudioManager {
  constructor() {
    this.localStream = null;
    this.audioContext = null;
    this.gainNode = null;
    this.analyser = null;
    this.vuCallback = null;
    this.unlocked = false;
    this.volume = 1;
  }

  async unlockAudio() {
    if (this.unlocked) return true;
    try {
      // iOS requires AudioContext resume on user gesture
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      // Play silent buffer to unlock
      const buffer = this.audioContext.createBuffer(1, 1, 22050);
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.start(0);
      this.unlocked = true;
      return true;
    } catch(e) {
      console.warn('unlock failed', e);
      return false;
    }
  }

  async getMic() {
    if (this.localStream) {
      // keep alive, ensure tracks enabled false initially
      this.localStream.getAudioTracks().forEach(t=> t.enabled = false);
      return this.localStream;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      }
    });
    // Important: keep stream alive, disable initially
    stream.getAudioTracks().forEach(t => t.enabled = false);
    this.localStream = stream;

    // Setup analyser for VU meter
    if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const src = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);
    } catch(e){ console.warn('analyser fail', e); }

    return stream;
  }

  setTransmitting(isTx) {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach(t => {
      t.enabled = !!isTx; // clave: no detener track, solo enabled toggle
    });
  }

  setVolume(v) {
    this.volume = v;
    document.querySelectorAll('#remote-audios audio').forEach(a => a.volume = v);
  }

  createRemoteAudio(peerId) {
    const container = document.getElementById('remote-audios');
    let el = document.getElementById(`audio-${peerId}`);
    if (el) return el;
    el = document.createElement('audio');
    el.id = `audio-${peerId}`;
    el.autoplay = true;
    el.playsInline = true;
    // @ts-ignore
    el.playsinline = true;
    el.controls = false;
    el.volume = this.volume;
    // critical for iOS
    el.setAttribute('autoplay','');
    el.setAttribute('playsinline','');
    container.appendChild(el);
    // Attempt play
    const tryPlay = () => el.play().catch(()=>{});
    el.addEventListener('loadedmetadata', tryPlay);
    // unlock retry
    setTimeout(tryPlay, 200);
    return el;
  }

  removeRemoteAudio(peerId) {
    const el = document.getElementById(`audio-${peerId}`);
    if (el) {
      try { el.srcObject = null; } catch(e){}
      el.remove();
    }
  }

  attachRemoteStream(peerId, stream) {
    const audio = this.createRemoteAudio(peerId);
    audio.srcObject = stream;
    audio.volume = this.volume;
    const p = audio.play();
    if (p && p.catch) p.catch(err=>{
      console.warn(`audio play blocked for ${peerId}`, err);
      // retry after user interaction
      const onInteract = () => {
        audio.play().catch(()=>{});
        window.removeEventListener('pointerdown', onInteract);
      };
      window.addEventListener('pointerdown', onInteract, { once:true });
    });
    return audio;
  }

  // Beeps via WebAudio - no files needed, works on iOS after unlock
  beep(type='in') {
    if (!this.audioContext) return;
    try {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.connect(gain); gain.connect(this.audioContext.destination);
      osc.frequency.value = type==='in' ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, this.audioContext.currentTime+0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime+0.18);
      osc.start(); osc.stop(this.audioContext.currentTime+0.2);
    } catch(e){}
  }

  startVuMeter(cb) {
    this.vuCallback = cb;
    const loop = () => {
      if (!this.analyser || !this.vuCallback) return;
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);
      let sum = 0; for (let i=0;i<data.length;i++) sum+=data[i];
      const avg = sum / data.length / 255; // 0-1
      cb(avg);
      requestAnimationFrame(loop);
    };
    loop();
  }
}