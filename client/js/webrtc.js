export class WebRTCManager {
  constructor(signaling, audioManager, roomCode) {
    this.signaling = signaling;
    this.audio = audioManager;
    this.roomCode = roomCode;
    this.peers = new Map(); // peerId -> { pc, remoteStream, iceRestartCount, state }
    this.localStream = null;
    this.iceServers = null;
    this.onUserSpeaking = null;
    this.onConnectionState = null;
    this.makingOffer = new Set();
  }

  async init(localStream) {
    this.localStream = localStream;
    await this.fetchIceServers();
    this.bindSignaling();
  }

  async fetchIceServers() {
    try {
      const res = await fetch('/api/ice-servers');
      const data = await res.json();
      this.iceServers = data.iceServers;
      console.log('[ice] servers', this.iceServers.length);
    } catch(e) {
      console.warn('[ice] fallback', e);
      this.iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];
    }
  }

  bindSignaling() {
    this.signaling.on('user-joined', async ({ user })=>{
      console.log('[webrtc] user-joined', user.id);
      // nosotros iniciamos offer hacia el nuevo (deterministic: id menor ofrece)
      await this.ensurePeer(user.id, true);
    });
    this.signaling.on('joined-room', async ({ users, you })=>{
      // crear peer para cada usuario existente
      for (const u of users) {
        if (u.id === you.id) continue;
        // regla simple para evitar glare: solo el id menor crea offer
        const shouldOffer = you.id < u.id;
        await this.ensurePeer(u.id, shouldOffer);
      }
    });
    this.signaling.on('offer', async ({ fromId, sdp })=>{
      await this.handleOffer(fromId, sdp);
    });
    this.signaling.on('answer', async ({ fromId, sdp })=>{
      await this.handleAnswer(fromId, sdp);
    });
    this.signaling.on('ice-candidate', async ({ fromId, candidate })=>{
      await this.handleRemoteIce(fromId, candidate);
    });
    this.signaling.on('user-left', ({ userId })=>{
      this.closePeer(userId);
    });
  }

  async ensurePeer(peerId, createOffer) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 2,
    });

    const remoteStream = new MediaStream();
    const entry = { pc, remoteStream, state: 'new', iceRestartCount:0, type: null, hasReceivedTrack:false };

    // Añadir track local persistente (1 sola vez)
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    pc.ontrack = (e) => {
      console.log('[pc] ontrack', peerId, e.track.kind);
      e.streams[0].getTracks().forEach(t=> remoteStream.addTrack(t));
      entry.hasReceivedTrack = true;
      // attach to audio element - recreable si falla
      this.audio.attachRemoteStream(peerId, remoteStream);
      // detectar audio activo para UI
      this.monitorRemoteAudio(peerId, remoteStream);
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signaling.sendIceCandidate(peerId, e.candidate, this.roomCode);
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      entry.state = s;
      console.log(`[pc ${peerId}] connectionState=${s}`);
      this.onConnectionState && this.onConnectionState(peerId, s, pc);
      if (s === 'failed') {
        this.restartIce(peerId);
      } else if (s === 'disconnected') {
        // intentar recuperación suave
        setTimeout(()=>{
          if (pc.connectionState === 'disconnected') this.restartIce(peerId);
        }, 2500);
      } else if (s === 'closed') {
        this.closePeer(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[pc ${peerId}] ice=${pc.iceConnectionState} sig=${pc.signalingState}`);
    };

    // Perfect negotiation pattern to avoid glare
    pc.onnegotiationneeded = async () => {
      if (!createOffer) return;
      try {
        if (this.makingOffer.has(peerId)) return;
        this.makingOffer.add(peerId);
        console.log(`[pc ${peerId}] negotiationneeded -> offer`);
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        this.signaling.sendOffer(peerId, pc.localDescription, this.roomCode);
      } catch(e){ console.warn('negotiation error', e); }
      finally { this.makingOffer.delete(peerId); }
    };

    this.peers.set(peerId, entry);

    if (createOffer) {
      // trigger initial offer
      // slight delay to allow ice gathering
      setTimeout(()=> {
        if (pc.signalingState === 'stable') pc.onnegotiationneeded();
      }, 100);
    }

    return entry;
  }

  async handleOffer(peerId, sdp) {
    const entry = await this.ensurePeer(peerId, false);
    const pc = entry.pc;
    try {
      const offerCollision = this.makingOffer.has(peerId) || pc.signalingState !== 'stable';
      const isPolite = this.signaling.socket.id > peerId; // id mayor es polite (acepta colisión)
      if (offerCollision && !isPolite) {
        console.log(`[pc ${peerId}] offer collision ignored (impolite)`);
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signaling.sendAnswer(peerId, pc.localDescription, this.roomCode);
      console.log(`[pc ${peerId}] answered offer`);
    } catch(e) {
      console.error(`[pc ${peerId}] handleOffer error`, e);
    }
  }

  async handleAnswer(peerId, sdp) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    try {
      await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log(`[pc ${peerId}] set remote answer`);
    } catch(e){ console.error('handleAnswer', e); }
  }

  async handleRemoteIce(peerId, candidate) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    try {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch(e){ console.warn('addIceCandidate fail', e); }
  }

  async restartIce(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    if (entry.iceRestartCount > 5) {
      console.log(`[pc ${peerId}] too many restarts, renegotiating fully`);
      this.closePeer(peerId);
      await this.ensurePeer(peerId, true);
      return;
    }
    entry.iceRestartCount++;
    console.log(`[pc ${peerId}] restartIce #${entry.iceRestartCount}`);
    try {
      const offer = await entry.pc.createOffer({ iceRestart: true });
      await entry.pc.setLocalDescription(offer);
      this.signaling.sendOffer(peerId, entry.pc.localDescription, this.roomCode);
    } catch(e){ console.error('restartIce error', e); }
  }

  async restartAllIce() {
    for (const id of this.peers.keys()) await this.restartIce(id);
  }

  monitorRemoteAudio(peerId, stream) {
    try {
      const ctx = this.audio.audioContext;
      if (!ctx) return;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const check = () => {
        if (!this.peers.has(peerId)) return;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a,b)=>a+b,0)/data.length;
        if (avg > 15) {
          this.onUserSpeaking && this.onUserSpeaking(peerId, true);
        }
        requestAnimationFrame(check);
      };
      check();
    } catch(e){}
  }

  closePeer(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    try { entry.pc.close(); } catch(e){}
    this.peers.delete(peerId);
    this.audio.removeRemoteAudio(peerId);
    console.log(`[pc ${peerId}] closed and cleaned`);
  }

  closeAll() {
    for (const id of Array.from(this.peers.keys())) this.closePeer(id);
  }

  getStats() {
    const out = [];
    for (const [id, e] of this.peers.entries()) {
      const pc = e.pc;
      out.push({
        peerId: id,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        signalingState: pc.signalingState,
        iceRestartCount: e.iceRestartCount,
        hasTrack: e.hasReceivedTrack,
        iceServers: pc.getConfiguration().iceServers?.length || 0,
      });
    }
    return out;
  }

  async getSelectedCandidatePairs() {
    const pairs = [];
    for (const [id, e] of this.peers.entries()) {
      try {
        const stats = await e.pc.getStats();
        stats.forEach(r=>{
          if (r.type==='candidate-pair' && r.state==='succeeded' && r.nominated) {
            pairs.push({ peerId:id, local: r.localCandidateId, remote: r.remoteCandidateId, ...r });
          }
        });
      } catch(e){}
    }
    return pairs;
  }
}