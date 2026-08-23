export class PTTManager {
  constructor({ btn, audioManager, signaling, getRoomCode, onStateChange }) {
    this.btn = btn;
    this.audio = audioManager;
    this.signaling = signaling;
    this.getRoomCode = getRoomCode;
    this.onStateChange = onStateChange; // (state: 'idle'|'requesting'|'talking'|'busy'|'blocked')
    this.isPressed = false;
    this.isTalking = false;
    this.blocked = false;
    this.currentSpeakerId = null;
    this.maxDurationTimer = null;
    this.safetyReleaseTimer = null;

    this.bindEvents();
    this.bindSignaling();
    // seguridad: liberar al cambiar pestaña / bloquear pantalla
    document.addEventListener('visibilitychange', ()=>{ if (document.hidden) this.forceRelease('visibility'); });
    window.addEventListener('blur', ()=> this.forceRelease('blur'));
    window.addEventListener('pagehide', ()=> this.forceRelease('pagehide'));
  }

  bindSignaling() {
    this.signaling.on('talk-granted', ({ speakerId })=>{
      if (speakerId === this.signaling.socket.id) {
        // me otorgaron
        this.startLocalTalk();
      } else {
        // otro habla
        this.setBlocked(speakerId, true);
      }
    });
    this.signaling.on('talk-released', ({ speakerId })=>{
      if (this.currentSpeakerId === speakerId) {
        this.setBlocked(null, false);
      }
      if (speakerId === this.signaling.socket.id && this.isTalking) {
        this.stopLocalTalk();
      }
    });
    this.signaling.on('channel-busy', ({ busyBy })=>{
      const name = busyBy?.name || 'otro usuario';
      this.onStateChange && this.onStateChange({ state:'busy', speaker: busyBy, message:`CANAL OCUPADO POR ${name.toUpperCase()}` });
      // vibrar
      if (navigator.vibrate) navigator.vibrate(80);
    });
    this.signaling.on('channel-state', ({ speakerId, speaker })=>{
      if (speakerId) {
        if (speakerId !== this.signaling.socket.id) this.setBlocked(speakerId, true, speaker);
      } else {
        this.setBlocked(null, false);
      }
    });
  }

  bindEvents() {
    const el = this.btn;
    const start = (e)=>{
      e.preventDefault();
      if (this.blocked || this.isPressed) return;
      this.isPressed = true;
      this.btn.classList.add('pressed');
      // solicitar canal al servidor (autoridad)
      this.onStateChange && this.onStateChange({ state:'requesting', message:'SOLICITANDO CANAL...' });
      this.signaling.requestTalk(this.getRoomCode());

      // safety: si no hay respuesta en 2s, permitir reintento
      clearTimeout(this.safetyReleaseTimer);
      this.safetyReleaseTimer = setTimeout(()=>{
        if (!this.isTalking) {
          this.isPressed = false;
          this.btn.classList.remove('pressed');
          this.onStateChange && this.onStateChange({ state:'idle', message:'CANAL LIBRE' });
        }
      }, 2500);

      if (navigator.vibrate) navigator.vibrate(30);
    };
    const end = (e)=>{
      e.preventDefault();
      if (!this.isPressed) return;
      this.isPressed = false;
      this.btn.classList.remove('pressed');
      clearTimeout(this.safetyReleaseTimer);
      if (this.isTalking) {
        this.signaling.releaseTalk(this.getRoomCode());
        this.stopLocalTalk();
      }
    };

    // Usar pointer events - mejor para iOS/Android
    el.addEventListener('pointerdown', start, { passive:false });
    el.addEventListener('pointerup', end, { passive:false });
    el.addEventListener('pointercancel', end, { passive:false });
    el.addEventListener('pointerleave', (e)=>{ if (this.isPressed) end(e); }, { passive:false });
    // Fallback touch
    el.addEventListener('touchstart', start, { passive:false });
    el.addEventListener('touchend', end, { passive:false });
    // Prevenir context menu
    el.addEventListener('contextmenu', e=> e.preventDefault());
  }

  startLocalTalk() {
    if (this.isTalking) return;
    this.isTalking = true;
    this.currentSpeakerId = this.signaling.socket.id;
    this.audio.setTransmitting(true);
    this.audio.beep('in');
    this.onStateChange && this.onStateChange({ state:'talking', message:'TRANSMITIENDO', self:true });
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

    // max duration safety 30s
    clearTimeout(this.maxDurationTimer);
    this.maxDurationTimer = setTimeout(()=>{
      this.forceRelease('max-duration');
    }, 30000);
  }

  stopLocalTalk() {
    if (!this.isTalking) return;
    this.isTalking = false;
    this.currentSpeakerId = null;
    this.audio.setTransmitting(false);
    this.audio.beep('out');
    this.onStateChange && this.onStateChange({ state:'idle', message:'CANAL LIBRE' });
    clearTimeout(this.maxDurationTimer);
    if (navigator.vibrate) navigator.vibrate(30);
  }

  setBlocked(speakerId, blocked, speakerInfo=null) {
    this.blocked = blocked;
    this.currentSpeakerId = blocked ? speakerId : null;
    if (blocked) {
      this.btn.disabled = true;
      this.btn.classList.add('busy');
      const name = speakerInfo?.name || 'USUARIO';
      this.onStateChange && this.onStateChange({ state:'blocked', speaker: speakerInfo, message:`TRANSMITIENDO: ${name.toUpperCase()}`, speakerId });
    } else {
      this.btn.disabled = false;
      this.btn.classList.remove('busy');
      this.onStateChange && this.onStateChange({ state:'idle', message:'CANAL LIBRE' });
    }
  }

  forceRelease(reason) {
    if (this.isPressed || this.isTalking) {
      console.log(`[ptt] force release ${reason}`);
      this.isPressed = false;
      this.btn.classList.remove('pressed');
      if (this.isTalking) {
        this.signaling.releaseTalk(this.getRoomCode());
        this.stopLocalTalk();
      }
    }
  }
}