# 📻 Walkie Pro V2 — Radio PTT Real por Internet

Aplicación web PTT profesional, estable en iPhone Safari, Chrome Android y desktop. Arquitectura diseñada para corregir los fallos comunes de WebRTC: audio que solo suena una vez, cortes a los 3 segundos, dirección única, permisos iOS.

## Arquitectura (corrección de tu versión anterior)

**Problema anterior:** creabas una PeerConnection nueva en cada PTT. Eso provoca:
- ICE gathering race
- SDP glare
- audio element recolectado
- autoplay bloqueado en iOS después del primer play()
- track ended

**Solución V2 — Conexión persistente por peer:**
- `peerConnections = new Map<peerId, RTCPeerConnection>` — 1 conexión por usuario, nunca por PTT
- `localStream` se obtiene UNA vez con getUserMedia y se mantiene vivo todo el tiempo
- Transmisión controlada solo con `track.enabled = true/false` — sin renegociación, sin replaceTrack
- Server es autoridad del canal: `REQUEST_TALK -> GRANT_TALK / CHANNEL_BUSY -> RELEASE_TALK`
- Perfect negotiation pattern para evitar glare
- ICE restart automático + reconexión con `connectionState` observer
- `<audio autoplay playsinline>` por peer, creado tras gesto de usuario, nunca destruido hasta que el peer sale
- AudioContext desbloqueado en el primer tap (iOS)
- Safety timers: max 30s TX, force release en visibilitychange / blur / pointercancel

### Flujo de señalización
```
Cliente A join-room --> Server --> broadcast user-joined
Cliente B (existente) ensurePeer(id menor ofrece) --> offer --> server --> Cliente A
Cliente A setRemote + answer --> server --> Cliente B
ICE candidates intercambiados
remoteStream -> <audio>.play()
PTT: request-talk -> server verifica currentSpeaker -> grant / busy
track.enabled = true -> todos escuchan
release-talk -> canal libre
```

## Estructura
```
walkie-pro-v2/
├── client/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js           # estado UI + orquestación
│       ├── webrtc.js        # ConnectionManager persistente
│       ├── signaling.js     # Socket.IO client
│       ├── audio.js         # mic persistente + remote audio + beeps
│       ├── ptt.js           # pointer events + autoridad servidor
│       ├── rooms.js         # deviceId + códigos
│       └── diagnostics.js
├── server/
│   ├── server.js            # Express + Socket.IO
│   ├── signaling.js         # rooms + canal único
│   ├── rooms.js             # RoomManager
│   └── turn.js              # endpoint /api/ice-servers con credenciales temporales
├── .env.example
└── README.md
```

## Instalación local
```bash
cd server
npm install
cp ../.env.example .env
# edita TURN
npm run dev
# abre http://localhost:3000
```

## Variables .env
```
PORT=3000
TURN_URLS=turn:openrelay.metered.ca:80,turn:openrelay.metered.ca:443,turns:openrelay.metered.ca:443?transport=tcp
TURN_USERNAME=openrelayproject
TURN_CREDENTIAL=openrelayproject
# Producción recomendada con secret temporal (coturn):
# TURN_SECRET=tu_secreto
# TURN_TTL=86400
```

**TURN:** V2 trae fallback público (openrelay.metered.ca) para pruebas. Para producción usa Metered.ca, Cloudflare Calls, o tu coturn con secret. El endpoint `/api/ice-servers` genera credenciales temporales vía HMAC si defines TURN_SECRET, así no expones credenciales permanentes.

## Despliegue HTTPS (requerido para mic en móviles)

### Render.com
1. Nuevo Web Service -> conecta repo
2. Root: server, Build: npm install, Start: npm start
3. Añade env vars
4. Deploy -> obtienes https://walkie-pro.onrender.com

### Railway / Fly.io / Vercel (serverless no sirve para Socket.IO, usa Node)
- Asegura que el servidor sirva /client como estático (ya lo hace)
- Activa WebSocket support

## iOS Safari checklist implementado
- [x] getUserMedia solo tras tap en ENTRAR
- [x] AudioContext.resume() en gesto
- [x] <audio playsinline autoplay> creado tras gesto
- [x] No usar autoPlay sin interacción previa
- [x] pointerdown/up en lugar de solo click
- [x] safety release en visibilitychange
- [x] no detener tracks, solo enabled=false

## Pruebas (guía)
1. iPhone A -> iPhone B (misma sala)
2. iPhone -> Android
3. Android -> iPhone
4. WiFi -> 4G/5G
5. 4G -> 4G
6. 3 usuarios simultáneos
7. Salir y volver a entrar (debe renegociar)
8. Desconectar internet 5s y reconectar (ICE restart)
9. Transmisiones consecutivas: Mike habla/suelta/Jairo habla/suelta/Mike habla... (debe seguir funcionando indefinidamente)

Cada prueba debe verificar:
- Mic: OK
- Señalización: OK
- Audio remoto continuo >10s
- Sin cortes a los 3s
- Channel lock funciona

## Futuro (arquitectura preparada)
- Mensajes texto: añadir evento `text-message` en signaling.js
- Ubicación: añadir track de datos DataChannel
- Vibración/sonidos: ya implementado, extensible
- Grabación: usar MediaRecorder sobre remoteStream
- Admin salas: añadir campo role en RoomManager

## Licencia MIT