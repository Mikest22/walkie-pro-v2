import crypto from 'crypto';

export function getIceServers() {
  const urls = (process.env.TURN_URLS || '').split(',').map(s=>s.trim()).filter(Boolean);
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  const secret = process.env.TURN_SECRET;
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  if (secret) {
    // TURN REST API - credenciales temporales
    const ttl = parseInt(process.env.TURN_TTL || '86400',10);
    const timestamp = Math.floor(Date.now()/1000) + ttl;
    const user = `${timestamp}:walkiepro`;
    const hmac = crypto.createHmac('sha1', secret).update(user).digest('base64');
    // Si TURN_URLS no está, usa placeholder coturn
    const turnUrls = urls.length ? urls : ['turn:your-turn.com:3478'];
    turnUrls.forEach(u => {
      servers.push({ urls: u, username: user, credential: hmac });
    });
  } else if (username && credential && urls.length) {
    urls.forEach(u => {
      servers.push({ urls: u, username, credential });
    });
  }
  return servers;
}

// Para producción segura, expone solo vía endpoint y sin loguear credenciales permanentes en cliente
export function iceServersHandler(req, res) {
  const servers = getIceServers();
  // no enviar credenciales permanentes si hay secret? de todos modos las temporales son ok
  res.json({ iceServers: servers });
}