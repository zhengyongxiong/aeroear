import { F } from './sim.js';

export { F };

export const DEFAULT_PROFILE = {
  schema: 2,
  version: 1,
  L: { rateMax: 10, dpComfort: 4, lead: 8 },
  R: { rateMax: 10, dpComfort: 4, lead: 8 },
  history: [],
  questionnaire: null,
};

export const DEFAULT_SETTINGS = {
  onboarded: false,
  source: 'sim',
  dataV: 3,
  simScenario: 'flightDescent',
  simSpeed: 20,
  qnh: 1013.25,
  prompts: true,
  experiment: false,
  safetyLimit: 12, // hPa，占位值，待医学顾问确认
};

export const LIMITS = {
  rateMax: [3, 20],
  dpComfort: [1.5, 8],
  lead: [0, 30],
};

const load = (k, d) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return { ...structuredClone(d), ...(v || {}) };
  } catch {
    return structuredClone(d);
  }
};

export const state = {
  profile: load('aeroear.profile', DEFAULT_PROFILE),
  settings: load('aeroear.settings', DEFAULT_SETTINGS),
  predict: true,
  swapped: false,
  connected: false,
  deviceName: null,
  battery: null,
  live: [],
  last: null,
  rate: 0, // hPa/min，平滑后
  trip: null,
  win: 300,
};

export const LIVE_MAX = 6000; // 10 Hz × 10 min

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, (e) => fn(e.detail));

export function saveProfile() {
  state.profile.version = (state.profile.version + 1) & 0xffff;
  localStorage.setItem('aeroear.profile', JSON.stringify(state.profile));
  emit('profile');
}

export function saveSettings() {
  localStorage.setItem('aeroear.settings', JSON.stringify(state.settings));
  emit('settings');
}

export const otherSide = (s) => (s === 'L' ? 'R' : 'L');
export const earParams = (side) => state.profile[state.swapped ? otherSide(side) : side];

export const altitude = (pPa, qnh) => 44330 * (1 - Math.pow(pPa / 100 / qnh, 1 / 5.255));
export const qnhFromAlt = (pPa, h) => pPa / 100 / Math.pow(1 - h / 44330, 5.255);

export const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '--');
export const signed = (n, d = 1) => {
  if (!Number.isFinite(n)) return '--';
  const r = Number(n.toFixed(d));
  return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(d);
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function fmtDate(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 舒适状态：ok / warn / risk
export function statusOf(dpPa, prm, limitHpa, safety) {
  const a = Math.abs(dpPa) / 100;
  if (safety || a > limitHpa * 0.75) return 'risk';
  if (a > prm.dpComfort) return 'warn';
  return 'ok';
}
export const STATUS_TEXT = { ok: '舒适', warn: '注意', risk: '不适风险' };
export const STATUS_CODE = { ok: 'NORM', warn: 'CAUT', risk: 'WARN' };

export function sparkline(samples, n = 48) {
  const out = { L: [], R: [] };
  if (!samples.length) return out;
  const step = Math.max(1, samples.length / n);
  for (let i = 0; i < samples.length; i += step) {
    const s = samples[Math.floor(i)];
    out.L.push(Math.round(s.dpL));
    out.R.push(Math.round(s.dpR));
  }
  return out;
}

export const TRIP_TYPES = {
  flight: { name: '飞行', code: 'FLT', dest: '座舱 7000 ft', scenario: 'flight', desc: '起飞爬升、降落下降时提前调节', icon: 'plane' },
  elevator: { name: '高速电梯', code: 'ELV', dest: '高层 150 m', scenario: 'elevator', desc: '高层楼宇、观光塔快速升降', icon: 'elevator' },
  mountain: { name: '山路 / 高铁', code: 'MTN', dest: '山口 1000 m', scenario: 'mountain', desc: '盘山公路、隧道与高铁会车', icon: 'mountain' },
  experiment: { name: '实验记录', code: 'EXP', dest: '真空箱', scenario: 'chamber', desc: '真空箱 A/B 对比、左右参数对调', icon: 'flask' },
};

// 阶段识别：rate 为环境气压变化 hPa/min
// sticky=true 时带迟滞：速率超过 ±2.5 hPa/min 才切换，回到 ±1.2 以内才回到平稳，避免座舱扰动造成标签抖动
let stickyKey = 'level';
export function phaseOf(rate, alt, type, sticky = false) {
  let k;
  if (sticky) {
    if (rate < -2.5) stickyKey = 'up';
    else if (rate > 2.5) stickyKey = 'down';
    else if (Math.abs(rate) < 1.2) stickyKey = 'level';
    k = stickyKey;
  } else k = rate < -1.5 ? 'up' : rate > 1.5 ? 'down' : 'level';
  const map = {
    flight: { up: ['爬升', 'CLB'], down: ['下降', 'DES'], level: alt > 500 ? ['巡航', 'CRZ'] : ['地面', 'GND'] },
    elevator: { up: ['上行', 'UP'], down: ['下行', 'DN'], level: ['停靠', 'HOLD'] },
  }[type] || { up: ['上升', 'CLB'], down: ['下降', 'DES'], level: ['平稳', 'LVL'] };
  return { key: k, name: map[k][0], code: map[k][1] };
}

export function computeMetrics(samples, params) {
  const side = () => ({ peak: 0, load: 0, maxRate: 0, safety: 0 });
  const m = { L: side(), R: side(), duration: 0, pMin: 0, pMax: 0 };
  if (!samples.length) return m;
  const t0 = samples[0].t;
  m.duration = (samples[samples.length - 1].t - t0) / 1000;
  let pMin = Infinity, pMax = -Infinity;
  const anchor = { L: null, R: null };
  const sPrev = { L: false, R: false };
  let prev = null;
  for (const s of samples) {
    pMin = Math.min(pMin, s.pAmb);
    pMax = Math.max(pMax, s.pAmb);
    for (const k of ['L', 'R']) {
      const dp = s['dp' + k];
      const a = Math.abs(dp) / 100;
      const o = m[k];
      o.peak = Math.max(o.peak, a);
      if (prev) o.load += Math.max(0, a - params[k].dpComfort) * ((s.t - prev.t) / 1000);
      const pc = s.pAmb + dp;
      const an = anchor[k];
      if (!an) anchor[k] = { t: s.t, p: pc };
      else if (s.t - an.t >= 2000) {
        o.maxRate = Math.max(o.maxRate, (Math.abs(pc - an.p) * 0.6) / ((s.t - an.t) / 1000));
        anchor[k] = { t: s.t, p: pc };
      }
      const sf = !!(s.flags & (k === 'L' ? F.SL : F.SR));
      if (sf && !sPrev[k]) o.safety++;
      sPrev[k] = sf;
    }
    prev = s;
  }
  m.pMin = pMin / 100;
  m.pMax = pMax / 100;
  return m;
}

// 以 step 毫秒重采样某字段，便于对比
export function resample(samples, key, step, n) {
  const out = new Array(n).fill(NaN);
  if (!samples.length) return out;
  const t0 = samples[0].t;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * step;
    while (j < samples.length - 1 && samples[j + 1].t <= t) j++;
    if (samples[j].t <= t + step) out[i] = samples[j][key];
  }
  return out;
}

export function corr(a, b) {
  const x = [], y = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) { x.push(a[i]); y.push(b[i]); }
  }
  const n = x.length;
  if (n < 3) return NaN;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// 数据迁移：v1.4 起座舱速率按真实客机量级（适应速度范围 3–20），并默认使用「客机全程」剖面
// 判断依据是原始存档（load 会用默认值补全新字段，不能用合并后的对象判断）
const raw = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k));
  } catch {
    return null;
  }
};
const rawProfile = raw('aeroear.profile');
if (rawProfile && rawProfile.schema !== 2) {
  for (const k of ['L', 'R']) state.profile[k].rateMax = clamp(Math.round(state.profile[k].rateMax * 0.55 * 2) / 2, ...LIMITS.rateMax);
  localStorage.setItem('aeroear.profile', JSON.stringify(state.profile));
}
const rawSettings = raw('aeroear.settings');
if (rawSettings && rawSettings.dataV !== 3) {
  state.settings.dataV = 3;
  state.settings.simScenario = 'flightDescent';
  state.settings.simSpeed = 20;
  localStorage.setItem('aeroear.settings', JSON.stringify(state.settings));
}
