// 设备模拟器：环境气压曲线 + 左右耳塞气路物理模型 + 与固件一致的控制逻辑
// 无 DOM 依赖，可在 Node 中单独测试

import { FLIGHT_STEP, FLIGHT_PA, FLIGHT_DIST } from './flightdata.js';

const P0 = 101325;
export const altToPa = (h) => P0 * Math.pow(1 - h / 44330, 5.255);
const ease = (u) => (1 - Math.cos(Math.PI * u)) / 2;

export const TAU_OPEN = 0.15; // 阀门全开时气路时间常数 (s)
export const TAU_LEAK = 45; // 透气膜被动泄压时间常数 (s)

// segs: [持续秒数, 段末海拔 m]
export const SCENARIOS = {
  flightDescent: { name: '客机下降段', desc: '巡航末段 → 下降 → 进近 → 落地泄压（约 28 分钟，最容易耳闷）', speed: 20, real: true, from: 5900, to: 7600, win: 15, segs: [[1700, 0]] },
  flightClimb: { name: '客机爬升段', desc: '起飞滑跑 → 爬升到巡航（约 25 分钟）', speed: 20, real: true, from: 600, to: 2100, win: 15, segs: [[1500, 0]] },
  flight: { name: '客机全程', desc: '滑行 → 起飞 → 爬升 → 巡航 → 下降 → 落地（约 2.2 小时，巡航占大半）', speed: 60, real: true, from: 0, to: (FLIGHT_PA.length - 1) * FLIGHT_STEP, win: 15, segs: [[(FLIGHT_PA.length - 1) * FLIGHT_STEP, 0]] },
  flightQuick: { name: '飞行（简化）', desc: '起飞爬升 → 巡航 → 下降落地，约 40 分钟', speed: 10, segs: [[120, 0], [1200, 2000], [900, 2000], [1500, 0], [120, 0]] },
  elevator: { name: '高速电梯', desc: '150 m 上行与下行', speed: 1, segs: [[10, 0], [35, 150], [20, 150], [35, 0], [10, 0]] },
  mountain: { name: '山路 / 高铁', desc: '爬升 1000 m 后返回', speed: 5, segs: [[30, 0], [600, 1000], [120, 1000], [600, 0], [30, 0]] },
  chamber: { name: '真空箱', desc: '减压约 30 hPa → 保持 → 回压', speed: 1, segs: [[15, 0], [90, 260], [30, 260], [90, 0], [15, 0]] },
};

// 真实客机剖面：座舱气压序列线性插值，可截取 [from, to] 秒的片段，播放到结尾后保持
export function realProfile(from = 0, to = (FLIGHT_PA.length - 1) * FLIGHT_STEP) {
  const n = FLIGHT_PA.length;
  const fn = (time) => {
    const x = Math.max(0, Math.min(n - 1, (from + time) / FLIGHT_STEP));
    const i = Math.min(n - 2, Math.floor(x));
    const f = x - i;
    const base = FLIGHT_PA[i] + (FLIGHT_PA[i + 1] - FLIGHT_PA[i]) * f;
    return base + fn.noise * (FLIGHT_DIST[i] + (FLIGHT_DIST[i + 1] - FLIGHT_DIST[i]) * f);
  };
  fn.noise = 1; // 空调扰动增益：播放倍速 > 5 时按 5/倍速 衰减
  fn.duration = to - from;
  fn.real = true;
  return fn;
}

export function makeProfile(segs, linear = false) {
  const parts = [];
  let t = 0;
  let h = segs[0][1];
  for (const [d, h1] of segs) {
    parts.push({ t0: t, t1: t + d, h0: h, h1 });
    t += d;
    h = h1;
  }
  const dur = t;
  const fn = (time) => {
    const tm = ((time % dur) + dur) % dur;
    const p = parts.find((x) => tm < x.t1) || parts[parts.length - 1];
    const u = Math.min(1, (tm - p.t0) / (p.t1 - p.t0));
    return altToPa(p.h0 + (p.h1 - p.h0) * (linear ? u : ease(u)));
  };
  fn.duration = dur;
  return fn;
}

let spare = null;
export function gauss() {
  if (spare !== null) {
    const s = spare;
    spare = null;
    return s;
  }
  let u = 0;
  while (u === 0) u = Math.random();
  const v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u));
  spare = r * Math.sin(2 * Math.PI * v);
  return r * Math.cos(2 * Math.PI * v);
}

function regress(pts) {
  const n = pts.length;
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const x0 = pts[0][0];
  for (const [x, y] of pts) {
    const dx = x - x0;
    sx += dx; sy += y; sxx += dx * dx; sxy += dx * y;
  }
  const den = n * sxx - sx * sx;
  return den === 0 ? 0 : (n * sxy - sx * sy) / den;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 单侧耳塞控制器（固件参考实现）
// prm: { rateMax: hPa/min, dpComfort: hPa, lead: s }
export class EarController {
  constructor() { this.reset(); }
  reset() { this.ref = null; this.safe = false; this.react = false; }
  update(dt, pAmb, pc, prm, predictOn, slope, limitPa) {
    const dp = pc - pAmb;
    if (this.ref === null) this.ref = pc;
    if (Math.abs(dp) > limitPa) this.safe = true;
    else if (this.safe && Math.abs(dp) < limitPa * 0.5) this.safe = false;
    if (this.safe) {
      this.ref = pc;
      return { duty: 100, safety: true };
    }
    const rateMax = (prm.rateMax * 100) / 60; // Pa/s
    if (!predictOn) {
      // 常规（反应式）：压差超出舒适带才开阀
      const comfort = prm.dpComfort * 100;
      if (Math.abs(dp) > comfort) this.react = true;
      else if (Math.abs(dp) < comfort * 0.3) this.react = false;
      this.ref = pc;
      return { duty: this.react ? 100 : 0, safety: false };
    }
    // 预测式：参考轨迹以个人速率提前跟随预测气压；压差超出舒适带后逐步提速，避免累积
    const comfort = prm.dpComfort * 100;
    const over = Math.max(0, Math.abs(dp) - comfort);
    const rate = rateMax * (1 + (3 * over) / comfort);
    const target = pAmb + slope * prm.lead;
    this.ref += clamp(target - this.ref, -rate * dt, rate * dt);
    const avail = pAmb - pc;
    if ((this.ref - pc) * avail < 0) this.ref = pc;
    const e = this.ref - pc;
    if (Math.abs(avail) < 20 || e * avail <= 0) return { duty: 0, safety: false }; // 死区 0.2 hPa：已追平时不对噪声动作
    const want = Math.min(Math.abs(e) * 2, rate);
    const full = Math.abs(avail) / TAU_OPEN;
    return { duty: clamp(want / full, 0, 1) * 100, safety: false };
  }
}

export const F = { VL: 1, VR: 2, SL: 4, SR: 8, PRED: 16, SWAP: 32 };

export class SimCore {
  constructor(key = 'flight') { this.setScenario(key); }
  setScenario(key) {
    this.key = SCENARIOS[key] ? key : 'flight';
    const sc = SCENARIOS[this.key];
    this.amb = sc.real ? realProfile(sc.from, sc.to) : makeProfile(sc.segs);
    this.win = sc.win || 3; // 速率估计窗口（秒）：飞行 15 s（座舱扰动大），电梯 3 s
    this.reset();
  }
  reset() {
    this.t = 0;
    const p = this.amb(0);
    this.pc = { L: p, R: p };
    this.ctl = { L: new EarController(), R: new EarController() };
    this.duty = { L: 0, R: 0 };
    this.safety = { L: false, R: false };
    this.hist = [];
    this.slope = 0;
    this.seq = 0;
    this.vent = 0;
  }
  // ctx: { params: {L, R}, predict, swapped, limitPa }
  step(dt, ctx) {
    this.t += dt;
    const pa = this.amb(this.t);
    const meas = pa + gauss() * 1.2;
    this.hist.push([this.t, meas]);
    while (this.hist.length && this.t - this.hist[0][0] > this.win) this.hist.shift();
    this.slope = regress(this.hist);
    for (const s of ['L', 'R']) {
      const r = this.ctl[s].update(dt, meas, this.pc[s] + gauss() * 0.8, ctx.params[s], ctx.predict, this.slope, ctx.limitPa);
      const duty = this.vent > 0 ? 100 : r.duty;
      this.duty[s] = duty;
      this.safety[s] = r.safety;
      const k = duty / 100 / TAU_OPEN + 1 / TAU_LEAK;
      this.pc[s] = pa + (this.pc[s] - pa) * Math.exp(-k * dt);
    }
    if (this.vent > 0) this.vent -= dt;
  }
  sample(ctx) {
    const pa = this.amb(this.t);
    let flags = 0;
    if (this.duty.L > 0) flags |= F.VL;
    if (this.duty.R > 0) flags |= F.VR;
    if (this.safety.L) flags |= F.SL;
    if (this.safety.R) flags |= F.SR;
    if (ctx.predict) flags |= F.PRED;
    if (ctx.swapped) flags |= F.SWAP;
    return {
      seq: (this.seq = (this.seq + 1) & 0xffff),
      t: Math.round(this.t * 1000),
      pAmb: pa + gauss() * 1.2,
      dpL: this.pc.L - pa + gauss() * 0.8,
      dpR: this.pc.R - pa + gauss() * 0.8,
      dutyL: Math.round(this.duty.L),
      dutyR: Math.round(this.duty.R),
      predSlope: this.slope,
      state: 0,
      flags,
    };
  }
}

// 参数预演：用给定的左右耳参数跑一次标准下降（800 m → 0，约 18 hPa/min），返回每秒压差
export function previewResponse(params, limitPa, predict = true) {
  const core = new SimCore('chamber');
  core.amb = makeProfile([[10, 730], [480, 0], [60, 0]], true);
  core.reset();
  const ctx = { params, predict, swapped: false, limitPa };
  const out = { t: [], L: [], R: [], amb: [] };
  const dt = 0.05;
  for (let i = 0; core.t < core.amb.duration; i++) {
    core.step(dt, ctx);
    if (i % 20 === 0) {
      const pa = core.amb(core.t);
      out.t.push(core.t);
      out.amb.push(pa);
      out.L.push(core.pc.L - pa);
      out.R.push(core.pc.R - pa);
    }
  }
  return out;
}

// 浏览器端定时驱动（10 Hz 输出）
export class Simulator {
  constructor(getCtx, onSample) {
    this.getCtx = getCtx;
    this.onSample = onSample;
    this.core = new SimCore();
    this.speed = 10;
    this.timer = null;
  }
  get running() { return !!this.timer; }
  start() {
    if (this.timer) return;
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), 100);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  setScenario(key) {
    this.core.setScenario(key);
    this.setSpeed(this.speed);
  }
  setSpeed(s) {
    this.speed = s;
    if (this.core.amb.real) this.core.amb.noise = Math.min(1, 5 / s);
  }
  reset() { this.core.reset(); }
  vent(sec = 3) { this.core.vent = sec; }
  tick() {
    const now = performance.now();
    const real = Math.min((now - this.last) / 1000, 0.5);
    this.last = now;
    const simDt = real * this.speed;
    const n = Math.max(1, Math.ceil(simDt / 0.02));
    const dt = simDt / n;
    const ctx = this.getCtx();
    for (let i = 0; i < n; i++) this.core.step(dt, ctx);
    if (this.core.amb.real && this.core.t > this.core.amb.duration + 30) this.core.reset();
    this.onSample(this.core.sample(ctx));
  }
}
