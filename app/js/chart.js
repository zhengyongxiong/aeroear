// 轻量 Canvas 折线图（无依赖，离线可用）
// opts: { series: [{ data:[[x,y]] | [[x,lo,hi]], type:'line'|'area', color, width, dash, glow }],
//         xMin, xMax, yMin?, yMax?, minSpan, band:{y0,y1,color}, zero, xFmt, yFmt, markers:[{x,label}] }
export function drawChart(cv, o) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const pad = { l: 42, r: 8, t: 8, b: 20 };
  let { yMin, yMax } = o;
  if (yMin == null || yMax == null) {
    yMin = Infinity;
    yMax = -Infinity;
    for (const s of o.series) {
      for (const d of s.data) {
        for (let i = 1; i < d.length; i++) {
          if (Number.isFinite(d[i])) {
            yMin = Math.min(yMin, d[i]);
            yMax = Math.max(yMax, d[i]);
          }
        }
      }
    }
    if (o.band) {
      yMin = Math.min(yMin, o.band.y0);
      yMax = Math.max(yMax, o.band.y1);
    }
    if (!Number.isFinite(yMin)) {
      yMin = 0;
      yMax = 1;
    }
    const span = o.minSpan || 1;
    if (yMax - yMin < span) {
      const mid = (yMax + yMin) / 2;
      yMin = mid - span / 2;
      yMax = mid + span / 2;
    }
    const p = (yMax - yMin) * 0.12;
    yMin -= p;
    yMax += p;
  }
  const { xMin, xMax } = o;
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const X = (x) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * iw;
  const Y = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin || 1)) * ih;

  c.font = '10px -apple-system, "PingFang SC", system-ui, sans-serif';
  c.textBaseline = 'middle';
  c.lineWidth = 1;
  const yFmt = o.yFmt || ((v) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(step % 1 ? 1 : 0)));
  const raw = (yMax - yMin) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) || 10 * mag;
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) {
    const y = Math.round(Y(v)) + 0.5;
    c.strokeStyle = 'rgba(30,60,120,0.09)';
    c.beginPath();
    c.moveTo(pad.l, y);
    c.lineTo(w - pad.r, y);
    c.stroke();
    c.fillStyle = 'rgba(30,50,90,0.5)';
    c.textAlign = 'right';
    c.fillText(yFmt(v), pad.l - 6, y);
  }

  if (o.band) {
    c.fillStyle = o.band.color || 'rgba(18,184,134,0.12)';
    c.fillRect(pad.l, Y(o.band.y1), iw, Y(o.band.y0) - Y(o.band.y1));
  }
  if (o.zero && yMin < 0 && yMax > 0) {
    c.strokeStyle = 'rgba(30,60,120,0.3)';
    c.setLineDash([3, 4]);
    c.beginPath();
    c.moveTo(pad.l, Y(0));
    c.lineTo(w - pad.r, Y(0));
    c.stroke();
    c.setLineDash([]);
  }

  c.save();
  c.beginPath();
  c.rect(pad.l, pad.t - 2, iw, ih + 4);
  c.clip();
  for (const s of o.series) {
    let data = s.data;
    const maxPts = Math.max(50, Math.floor(iw * 1.5));
    if (data.length > maxPts) {
      const step = data.length / maxPts;
      const d2 = [];
      for (let i = 0; i < data.length; i += step) d2.push(data[Math.floor(i)]);
      d2.push(data[data.length - 1]);
      data = d2;
    }
    if (!data.length) continue;
    if (s.type === 'area') {
      c.beginPath();
      data.forEach((d, i) => (i ? c.lineTo(X(d[0]), Y(d[2])) : c.moveTo(X(d[0]), Y(d[2]))));
      for (let i = data.length - 1; i >= 0; i--) c.lineTo(X(data[i][0]), Y(data[i][1]));
      c.closePath();
      c.fillStyle = s.color;
      c.fill();
      continue;
    }
    c.beginPath();
    let started = false;
    for (const d of data) {
      if (!Number.isFinite(d[1])) {
        started = false;
        continue;
      }
      if (started) c.lineTo(X(d[0]), Y(d[1]));
      else {
        c.moveTo(X(d[0]), Y(d[1]));
        started = true;
      }
    }
    c.strokeStyle = s.color;
    c.lineWidth = s.width || 2;
    c.lineJoin = 'round';
    c.setLineDash(s.dash || []);
    if (s.glow) {
      c.shadowColor = s.color;
      c.shadowBlur = 5;
    }
    c.stroke();
    c.shadowBlur = 0;
    c.setLineDash([]);
  }
  for (const m of o.markers || []) {
    const x = Math.round(X(m.x)) + 0.5;
    c.strokeStyle = 'rgba(245,159,0,0.7)';
    c.setLineDash([2, 3]);
    c.beginPath();
    c.moveTo(x, pad.t);
    c.lineTo(x, pad.t + ih);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#d98300';
    c.textAlign = 'left';
    c.fillText(m.label, x + 3, pad.t + 6);
  }
  c.restore();

  if (o.xFmt) {
    c.fillStyle = 'rgba(30,50,90,0.5)';
    c.textBaseline = 'alphabetic';
    const ticks = o.xTicks || [xMin, (xMin + xMax) / 2, xMax];
    ticks.forEach((t, i) => {
      c.textAlign = i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center';
      c.fillText(o.xFmt(t), X(t), h - 5);
    });
  }
}
