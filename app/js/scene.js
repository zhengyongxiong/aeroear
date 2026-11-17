// 视觉层：卡通舷窗场景、左右耳水球宝宝、航段剖面
const P0 = 1013.25;
const INK = '#2b2350';
export const COL = { L: '#3fa0ff', R: '#ff7a6b', violet: '#8b5cf6', mint: '#12c28c', amber: '#ffb400', red: '#ff4d5e', ink: 'rgba(43,35,80,0.55)', grid: 'rgba(43,35,80,0.1)' };
const altOf = (hpa, q = P0) => 44330 * (1 - Math.pow(hpa / q, 1 / 5.255));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const x = hex(a), y = hex(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
};

function setup(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  return { c, w, h };
}

export function drawPlane(c, x, y, ang, s = 1) {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.scale(s, s);
  c.lineJoin = 'round';
  c.lineWidth = 2.6;
  c.strokeStyle = INK;
  // 尾翼
  c.fillStyle = COL.R;
  c.beginPath();
  c.moveTo(-13, -5);
  c.lineTo(-25, -19);
  c.lineTo(-17, -19);
  c.lineTo(-4, -5.5);
  c.closePath();
  c.fill();
  c.stroke();
  // 机身
  c.fillStyle = '#fff';
  c.beginPath();
  c.moveTo(27, 0);
  c.bezierCurveTo(23, -7, 10, -8, -6, -7.5);
  c.lineTo(-23, -5.5);
  c.lineTo(-23, 4.5);
  c.lineTo(-6, 7);
  c.bezierCurveTo(10, 8, 23, 7, 27, 0);
  c.closePath();
  c.fill();
  c.stroke();
  // 机翼
  c.fillStyle = '#ffd23f';
  c.beginPath();
  c.moveTo(7, 3);
  c.lineTo(-9, 18);
  c.lineTo(-2, 18);
  c.lineTo(16, 3);
  c.closePath();
  c.fill();
  c.stroke();
  // 舷窗和眼睛
  c.fillStyle = '#8fd8ff';
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.arc(-4 - i * 5, -1.5, 1.8, 0, 7);
    c.fill();
  }
  c.fillStyle = INK;
  c.beginPath();
  c.arc(15, -2.5, 2.6, 0, 7);
  c.fill();
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(15.8, -3.3, 0.9, 0, 7);
  c.fill();
  c.fillStyle = '#ff9ecb';
  c.beginPath();
  c.arc(19, 1.5, 2, 0, 7);
  c.fill();
  c.restore();
}

function cloud(c, x, y, w, a) {
  const h = w * 0.42;
  const path = () => {
    c.beginPath();
    c.ellipse(x, y + h * 0.35, w * 0.5, h * 0.3, 0, 0, 7);
    c.moveTo(x - w * 0.22 + h * 0.38, y + h * 0.1);
    c.arc(x - w * 0.22, y + h * 0.1, h * 0.38, 0, 7);
    c.moveTo(x + w * 0.05 + h * 0.52, y - h * 0.1);
    c.arc(x + w * 0.05, y - h * 0.1, h * 0.52, 0, 7);
    c.moveTo(x + w * 0.3 + h * 0.34, y + h * 0.12);
    c.arc(x + w * 0.3, y + h * 0.12, h * 0.34, 0, 7);
  };
  c.globalAlpha = a;
  path();
  c.lineWidth = 6;
  c.lineJoin = 'round';
  c.strokeStyle = INK;
  c.stroke();
  path();
  c.fillStyle = '#fff';
  c.fill();
  c.globalAlpha = 1;
}

function sun(c, x, y, r, t) {
  c.save();
  c.translate(x, y);
  c.lineCap = 'round';
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.rotate(t * 0.3);
  for (let i = 0; i < 8; i++) {
    c.rotate(Math.PI / 4);
    c.beginPath();
    c.moveTo(r * 1.3, 0);
    c.lineTo(r * 1.75, 0);
    c.stroke();
  }
  c.rotate(-t * 0.3 - Math.PI * 2);
  c.fillStyle = '#ffd23f';
  c.beginPath();
  c.arc(0, 0, r, 0, 7);
  c.fill();
  c.stroke();
  c.fillStyle = INK;
  c.beginPath();
  c.arc(-r * 0.35, -r * 0.1, r * 0.1, 0, 7);
  c.arc(r * 0.35, -r * 0.1, r * 0.1, 0, 7);
  c.fill();
  c.fillStyle = '#ff9ecb';
  c.beginPath();
  c.arc(-r * 0.55, r * 0.2, r * 0.13, 0, 7);
  c.arc(r * 0.55, r * 0.2, r * 0.13, 0, 7);
  c.fill();
  c.lineWidth = 2.6;
  c.beginPath();
  c.arc(0, r * 0.12, r * 0.3, 0.2, Math.PI - 0.2);
  c.stroke();
  c.restore();
}

// 舷窗场景：天空随高度变深，云随升降速度流动，飞机拖着白色尾迹，预测用紫色点线延伸
export function startScene(cv, getCtx) {
  const clouds = Array.from({ length: 10 }, (_, i) => ({ x: Math.random(), y: Math.random(), s: 0.7 + Math.random() * 0.8, l: i % 3 }));
  let drift = 0, warm = 0, altS = null, last = performance.now(), clock = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const o = getCtx();
    if (!o.active || !cv.clientWidth) return;
    const s = setup(cv);
    if (!s) return;
    clock += dt;
    const { c, w, h } = s;
    const L = o.last;
    const alt = L ? altOf(L.pAmb / 100, o.qnh) : 0;
    altS = altS === null ? alt : altS + (alt - altS) * Math.min(1, dt * 3);
    const rate = o.rate || 0;
    warm += ((rate > 1.5 ? 1 : 0) - warm) * Math.min(1, dt * 1.5);
    drift += dt * (0.015 + Math.min(0.12, Math.abs(rate) / 160));
    const k = clamp(altS / 2500, 0, 1);

    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, mix('#6fd0ff', '#3f8dff', k));
    g.addColorStop(1, mix('#d9f3ff', '#9fd6ff', k));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    if (warm > 0.01) {
      const wg = c.createLinearGradient(0, h * 0.3, 0, h);
      wg.addColorStop(0, 'rgba(255,190,150,0)');
      wg.addColorStop(1, `rgba(255,170,130,${0.55 * warm})`);
      c.fillStyle = wg;
      c.fillRect(0, 0, w, h);
    }
    sun(c, w * 0.78, h * 0.3, w * 0.075, clock);

    const ground = 1 - clamp(altS / 1200, 0, 1);
    if (ground > 0.02) {
      c.globalAlpha = ground;
      c.lineWidth = 3;
      c.strokeStyle = INK;
      c.lineJoin = 'round';
      for (const [col, base, amp, ph] of [['#7fe3a8', 0.88, 0.05, 0], ['#4fcf88', 0.95, 0.04, 2]]) {
        c.fillStyle = col;
        c.beginPath();
        c.moveTo(0, h + 4);
        for (let x = 0; x <= w; x += 8) c.lineTo(x, h * (base - amp * Math.sin(x / w * 5 + ph + drift * 3)));
        c.lineTo(w, h + 4);
        c.closePath();
        c.fill();
        c.stroke();
      }
      c.globalAlpha = 1;
    }

    for (const cl of clouds) {
      const f = [0.5, 1, 1.8][cl.l];
      const x = ((((cl.x * 1.4 - drift * f) % 1.4) + 1.4) % 1.4 - 0.2) * w;
      const y = (((cl.y + (altS / 2500) * [0.6, 1.1, 1.8][cl.l]) % 1) * 1.1 - 0.05) * h;
      cloud(c, x, y, (46 + cl.l * 24) * cl.s * (w / 320), [0.6, 0.8, 1][cl.l]);
    }

    if (L && o.live.length > 1) {
      const win = o.win;
      const tMin = L.t - win * 1000;
      let i0 = o.live.length - 1;
      while (i0 > 0 && o.live[i0 - 1].t >= tMin) i0--;
      const pts = o.live.slice(i0);
      const ahead = win * 0.22;
      const pred = [];
      for (let q = 0; q <= 10; q++) {
        const tt = (ahead * q) / 10;
        pred.push([tt, altOf((L.pAmb + L.predSlope * tt) / 100, o.qnh)]);
      }
      const step = Math.max(1, Math.floor(pts.length / 140));
      const hist = [];
      for (let i = 0; i < pts.length; i += step) hist.push([(pts[i].t - L.t) / 1000, altOf(pts[i].pAmb / 100, o.qnh)]);
      hist.push([0, alt]);
      let lo = Infinity, hi = -Infinity;
      for (const p of [...hist, ...pred]) {
        lo = Math.min(lo, p[1]);
        hi = Math.max(hi, p[1]);
      }
      if (hi - lo < 30) {
        const m = (hi + lo) / 2;
        lo = m - 15;
        hi = m + 15;
      }
      const top = h * 0.2, bot = h * 0.66;
      const px = w * 0.58;
      const X = (t) => (t <= 0 ? px + (t / win) * (px - w * 0.06) : px + (t / ahead) * (w * 0.9 - px));
      const Y = (a) => bot - ((a - lo) / (hi - lo)) * (bot - top);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      const trailPath = () => {
        c.beginPath();
        hist.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))));
      };
      trailPath();
      c.strokeStyle = INK;
      c.lineWidth = 11;
      c.stroke();
      trailPath();
      c.strokeStyle = '#fff';
      c.lineWidth = 6;
      c.stroke();
      const predPath = () => {
        c.beginPath();
        pred.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))));
      };
      c.setLineDash([0.1, 13]);
      predPath();
      c.strokeStyle = INK;
      c.lineWidth = 10;
      c.stroke();
      predPath();
      c.strokeStyle = COL.violet;
      c.lineWidth = 6;
      c.stroke();
      c.setLineDash([]);
      const py = Y(alt);
      const nx = X(pred[2][0]), ny = Y(pred[2][1]);
      drawPlane(c, px, py, clamp(Math.atan2(ny - py, nx - px), -0.5, 0.5), w / 250);
    }
  };
  requestAnimationFrame(frame);
}

// ---------- 左右耳水球宝宝 ----------
const WAVE = 'M-60 0 q15 -7 30 0' + ' t30 0'.repeat(8) + ' V140 H-60 Z';
export function orbSVG(side, comfort, limit) {
  const max = limit * 1.2;
  const y = (v) => 60 - clamp(v / max, -1, 1) * 46;
  const [c1, c2] = side === 'L' ? ['#9ad4ff', '#3fa0ff'] : ['#ffbcae', '#ff7a6b'];
  const bubbles = [[26, 30, 0], [48, 44, 0.7], [70, 26, 1.3], [88, 48, 0.3], [58, 20, 1.8]]
    .map(([x, yy, d]) => `<circle class="bub" cx="${x}" cy="${yy + 20}" r="${2.6 + (x % 3)}" style="animation-delay:${d}s"/>`).join('');
  return `<svg viewBox="0 0 120 120" class="orb ${side}">
    <defs>
      <clipPath id="oc${side}"><circle cx="60" cy="60" r="52"/></clipPath>
      <linearGradient id="lg${side}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    </defs>
    <circle cx="60" cy="60" r="54" class="orb-glass"/>
    <g clip-path="url(#oc${side})">
      <rect x="0" y="${y(comfort).toFixed(1)}" width="120" height="${(y(-comfort) - y(comfort)).toFixed(1)}" class="orb-band"/>
      <g class="liq" style="transform:translateY(60px)">
        <path d="${WAVE}" fill="url(#lg${side})" opacity=".55" class="wv w2"/>
        <path d="${WAVE}" fill="url(#lg${side})" class="wv w1"/>
        <g class="bubs">${bubbles}</g>
      </g>
      <line x1="0" x2="120" y1="60" y2="60" class="orb-zero"/>
    </g>
    <circle cx="60" cy="60" r="54" class="orb-ring" fill="none"/>
    <path d="M26 40a40 40 0 0 1 22-18" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".9"/>
    <g class="face">
      <ellipse class="eye" cx="46" cy="52" rx="4.6" ry="5.6"/><ellipse class="eye" cx="74" cy="52" rx="4.6" ry="5.6"/>
      <circle class="hl" cx="47.6" cy="50" r="1.6"/><circle class="hl" cx="75.6" cy="50" r="1.6"/>
      <circle class="cheek" cx="35" cy="64" r="5"/><circle class="cheek" cx="85" cy="64" r="5"/>
      <path class="mouth m-ok" d="M50 64 Q60 74 70 64"/>
      <ellipse class="mouth m-warn" cx="60" cy="68" rx="4.5" ry="5.5"/>
      <path class="mouth m-risk" d="M48 72 Q54 64 60 70 T72 70"/>
      <path class="sweat" d="M92 40 q6 8 0 12 q-6 -4 0 -12z"/>
    </g>
  </svg>`;
}

export function setOrb(card, dp, duty, limit) {
  const max = limit * 1.2;
  const y = 60 - clamp(dp / 100 / max, -1, 1) * 46;
  const liq = card.querySelector('.liq');
  if (liq) liq.style.transform = `translateY(${y.toFixed(1)}px)`;
  card.classList.toggle('venting', duty > 5);
  card.style.setProperty('--wave', duty > 5 ? '1.6s' : '3.6s');
}

// ---------- 航段剖面 ----------
export function drawTripProfile(cv, o) {
  const s = setup(cv);
  if (!s) return;
  const { c, w, h } = s;
  const sm = o.samples;
  const padL = 8, padR = 8, top = 14, band = 10, bot = h - 20 - band;
  c.font = '700 10px -apple-system, "PingFang SC", system-ui, sans-serif';
  if (sm.length < 2) {
    c.fillStyle = COL.ink;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('等待数据…', w / 2, h / 2);
    return;
  }
  const t0 = sm[0].t;
  const span = Math.max(o.minSpan || 60, (sm[sm.length - 1].t - t0) / 1000);
  const alts = sm.map((q) => altOf(q.pAmb / 100, o.qnh));
  let aMin = Math.min(...alts), aMax = Math.max(...alts);
  if (aMax - aMin < 30) {
    const m = (aMax + aMin) / 2;
    aMin = m - 15;
    aMax = m + 15;
  }
  const pd = (aMax - aMin) * 0.18;
  aMin -= pd;
  aMax += pd;
  const X = (t) => padL + ((t - t0) / 1000 / span) * (w - padL - padR);
  const Y = (a) => top + (1 - (a - aMin) / (aMax - aMin)) * (bot - top);

  c.strokeStyle = COL.grid;
  c.lineWidth = 1.5;
  c.setLineDash([4, 5]);
  for (let i = 0; i <= 3; i++) {
    const yy = top + ((bot - top) * i) / 3;
    c.beginPath();
    c.moveTo(padL, yy);
    c.lineTo(w - padR, yy);
    c.stroke();
  }
  c.setLineDash([]);
  const step = Math.max(1, Math.floor(sm.length / (w * 1.2)));
  const line = () => {
    c.beginPath();
    for (let i = 0; i < sm.length; i += step) {
      const xx = X(sm[i].t), yy = Y(alts[i]);
      i ? c.lineTo(xx, yy) : c.moveTo(xx, yy);
    }
  };
  const lx = X(sm[sm.length - 1].t), ly = Y(alts[alts.length - 1]);
  line();
  c.lineTo(lx, ly);
  c.lineTo(lx, bot);
  c.lineTo(X(t0), bot);
  c.closePath();
  c.fillStyle = 'rgba(63,160,255,0.22)';
  c.fill();
  line();
  c.lineTo(lx, ly);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = INK;
  c.lineWidth = 6;
  c.stroke();
  line();
  c.lineTo(lx, ly);
  c.strokeStyle = '#7fd0ff';
  c.lineWidth = 3;
  c.stroke();

  const col = { up: '#b79cff', down: '#ffc94a', level: '#7fd0ff' };
  for (let i = 1; i < sm.length; i++) {
    c.fillStyle = col[o.phaseOf(sm[i])] || col.level;
    c.fillRect(X(sm[i - 1].t), bot + 8, Math.max(1, X(sm[i].t) - X(sm[i - 1].t) + 0.5), band);
  }
  c.strokeStyle = INK;
  c.lineWidth = 2;
  c.strokeRect(padL, bot + 8, w - padL - padR, band);
  for (const e of o.events || []) {
    const tt = t0 + e.t;
    let j = 0;
    while (j < sm.length - 1 && sm[j].t < tt) j++;
    const ex = X(tt), ey = Y(alts[j]);
    c.fillStyle = e.side === 'L' ? COL.L : COL.R;
    c.strokeStyle = INK;
    c.lineWidth = 2.5;
    c.beginPath();
    if (e.type === 'blocked') c.arc(ex, ey, 6, 0, Math.PI * 2);
    else c.rect(ex - 5, ey - 5, 10, 10);
    c.fill();
    c.stroke();
  }
  if (o.plane) {
    const k = Math.max(0, sm.length - 6);
    const ang = clamp(Math.atan2(ly - Y(alts[k]), lx - X(sm[k].t) || 1), -0.6, 0.6);
    drawPlane(c, lx, ly, ang, 0.8);
  }
  c.fillStyle = COL.ink;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.fillText(`${Math.round(aMax)} m`, padL + 2, top + 10);
  c.fillText(`${Math.round(aMin)} m`, padL + 2, bot - 4);
}
