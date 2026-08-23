export function generateRoomCode() {
  const adj = ['ALFA','BRAVO','TANGO','MIKE','DELTA','ECHO','FOXTROT','RADIO','SIERRA','NOVA'];
  const noun = ['1','2','3','7','X','PRO','MAX','NET','LINK','BASE'];
  const a = adj[Math.floor(Math.random()*adj.length)];
  const b = noun[Math.floor(Math.random()*noun.length)];
  const n = Math.floor(Math.random()*90+10);
  return `${a}-${b}-${n}`;
}

export function getDeviceId() {
  let id = localStorage.getItem('walkie_device_id');
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem('walkie_device_id', id);
  }
  return id;
}

export function getRoomFromUrl() {
  const path = window.location.pathname;
  const m = path.match(/\/radio\/([^\/\?]+)/i);
  if (m) return decodeURIComponent(m[1]).toUpperCase();
  const params = new URLSearchParams(window.location.search);
  return (params.get('room') || params.get('sala') || '').toUpperCase();
}