import {
  state, on, emit, saveSettings, earParams, altitude, fmt, signed, statusOf, STATUS_TEXT, STATUS_CODE,
  LIVE_MAX, toast, phaseOf, TRIP_TYPES, computeMetrics, F, clamp, LIMITS, saveProfile, sparkline,
} from './state.js';
import { Simulator, SCENARIOS } from './sim.js';
import { BleDevice, OP } from './ble.js';
import { drawChart } from './chart.js';
import { startScene, orbSVG, setOrb } from './scene.js';
import { ICON } from './icons.js';
import { confetti } from './fx.js';
import * as db from './store.js';
import * as V from './views.js';

const $ = (s) => document.querySelector(s);
const fillIcons = (root = document) =>
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.firstChild) el.innerHTML = ICON[el.dataset.icon] || '';
  });

// ---------- 数据源 ----------
const ble = new BleDevice();
const sim = new Simulator(
  () => ({
    params: { L: earParams('L'), R: earParams('R') },
    predict: state.predict,
    swapped: state.swapped,
    limitPa: state.settings.safetyLimit * 100,
  }),
  (s) => ingest(s),
);

ble.addEventListener('sample', (e) => ingest(e.detail));
ble.addEventListener('connected', async (e) => {
  state.connected = true;
  state.deviceName = e.detail.name;
  state.battery = e.detail.battery ?? null;
  emit('conn');
  toast(`已连接 ${e.detail.name}`);
  await ble.writeProfile(state.profile).catch(() => {});
  await ble.send(OP.PREDICT, state.predict ? 1 : 0).catch(() => {});
  await ble.send(OP.SWAP, state.swapped ? 1 : 0).catch(() => {});
});
ble.addEventListener('disconnected', () => {
  state.connected = false;
  emit('conn');
  if (!ble.manual) toast('设备连接中断，正在重连…');
});

function clearLive() {
  state.live.length = 0;
  state.last = null;
}

function ingest(s) {
  const prev = state.last;
  if (prev && s.t < prev.t - 1000) clearLive();
  state.live.push(s);
  if (state.live.length > LIVE_MAX) state.live.splice(0, state.live.length - LIVE_MAX);
  state.last = s;
  const dtS = prev ? Math.max(0.01, (s.t - prev.t) / 1000) : 1;
  state.rate += ((s.predSlope * 60) / 100 - state.rate) * (1 - Math.exp(-dtS / 15));
  if (state.trip) recordTrip(s);
  checkEvents(s);
  emit('sample', s);
  scheduleRender();
}

// ---------- 行程记录 ----------
function recordTrip(s) {
  const tr = state.trip;
  if (tr.t0 == null) tr.t0 = s.t;
  if (tr.experiment || s.t - tr.lastT >= 1000 || tr.pendingMarker) {
    const rec = { ...s, sr: state.rate };
    if (tr.pendingMarker) {
      rec.marker = tr.pendingMarker;
      tr.markers.push({ t: s.t - tr.t0, label: tr.pendingMarker });
      tr.pendingMarker = null;
    }
    tr.samples.push(rec);
    tr.lastT = s.t;
  }
}

let wakeLock = null;
const api = {
  ble,
  sim,
  scenarios: SCENARIOS,
  async connectBle() {
    try {
      await ble.connect();
    } catch (err) {
      if (err.name !== 'NotFoundError') toast(err.message || '连接失败');
    }
  },
  disconnectBle() {
    ble.disconnect();
  },
  setSource(src) {
    state.settings.source = src;
    saveSettings();
    clearLive();
    if (src === 'sim') {
      ble.disconnect();
      sim.setScenario(state.settings.simScenario);
      sim.setSpeed(state.settings.simSpeed);
      sim.start();
    } else {
      sim.stop();
    }
    emit('conn');
  },
  setSimScenario(key, speed) {
    state.settings.simScenario = key;
    state.settings.simSpeed = speed ?? SCENARIOS[key].speed;
    saveSettings();
    sim.setScenario(key);
    sim.setSpeed(state.settings.simSpeed);
    clearLive();
  },
  setSimSpeed(v) {
    state.settings.simSpeed = v;
    saveSettings();
    sim.setSpeed(v);
  },
  resetSim() {
    sim.reset();
    clearLive();
  },
  setPredict(v) {
    state.predict = v;
    ble.send(OP.PREDICT, v ? 1 : 0).catch(() => {});
    emit('mode');
  },
  setSwapped(v) {
    state.swapped = v;
    ble.send(OP.SWAP, v ? 1 : 0).catch(() => {});
    emit('mode');
  },
  vent() {
    if (state.settings.source === 'sim') sim.vent(3);
    else ble.send(OP.VENT).catch(() => {});
    navigator.vibrate?.(40);
    toast('两侧阀门已全开泄压');
  },
  marker(code, label) {
    if (!state.trip) return;
    state.trip.pendingMarker = label;
    ble.send(OP.MARKER, code).catch(() => {});
    toast(`已标记：${label}`);
  },
  // 耳闷 / 通了 打卡：记录时间、阶段和当时的压差，供医生分析与参数学习
  logEvent(type, side) {
    const s = state.last;
    const tr = state.trip;
    if (!tr || !s) {
      toast('开始航程后，打卡会记入日志');
      return false;
    }
    const alt = altitude(s.pAmb, state.settings.qnh);
    const ev = {
      t: s.t - (tr.t0 ?? s.t), type, side,
      phase: phaseOf(state.rate, alt, tr.type, true).name,
      dpL: Math.round(s.dpL), dpR: Math.round(s.dpR),
    };
    tr.events.push(ev);
    tr.pendingMarker = `${side}${type === 'blocked' ? '闷' : '通'}`;
    navigator.vibrate?.(25);
    emit('event', ev);
    return true;
  },
  syncProfile() {
    if (state.connected) ble.writeProfile(state.profile).catch(() => toast('参数同步失败'));
  },
  async startTrip(type, opts = {}) {
    const isSim = state.settings.source === 'sim';
    if (!isSim && !state.connected) {
      toast('请先连接设备，或在设置中切换到模拟演示');
      return false;
    }
    const experiment = type === 'experiment';
    const scenario = opts.scenario || TRIP_TYPES[type].scenario;
    if (isSim) {
      sim.setScenario(scenario);
      sim.setSpeed(opts.speed ?? SCENARIOS[scenario].speed);
      clearLive();
    }
    state.trip = {
      type, experiment, scenario, source: state.settings.source, flightNo: opts.flightNo || '',
      start: Date.now(), samples: [], markers: [], events: [], t0: null, lastT: -1e9, pendingMarker: null,
      predict: state.predict, swapped: state.swapped,
      params: { L: { ...earParams('L') }, R: { ...earParams('R') } },
    };
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      wakeLock = null;
    }
    emit('trip');
    return true;
  },
  stopTrip() {
    const tr = state.trip;
    state.trip = null;
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
    if (state.settings.source === 'sim') {
      sim.setScenario(state.settings.simScenario);
      sim.setSpeed(state.settings.simSpeed);
      clearLive();
    }
    emit('trip');
    if (tr.experiment && (state.swapped || !state.predict)) {
      api.setSwapped(false);
      api.setPredict(true);
      toast('实验结束：已恢复预测开启、左右不对调');
    }
    return tr;
  },
  async saveTrip(tr, feedback, note) {
    if (!tr || tr.samples.length < 3) {
      toast('记录太短，未保存');
      return null;
    }
    const metrics = computeMetrics(tr.samples, tr.params);
    const base = tr.experiment
      ? `实验 · ${SCENARIOS[tr.scenario].name} · 预测${tr.predict ? '开' : '关'}${tr.swapped ? ' · 左右对调' : ''}`
      : TRIP_TYPES[tr.type].name;
    const meta = {
      type: tr.type, experiment: tr.experiment, scenario: tr.scenario, source: tr.source,
      name: tr.flightNo ? `${tr.flightNo} · ${base}` : base, flightNo: tr.flightNo,
      start: tr.start, end: Date.now(), predict: tr.predict, swapped: tr.swapped,
      params: tr.params, metrics, feedback: feedback || null, note: note || '', markers: tr.markers,
      events: tr.events, spark: sparkline(tr.samples),
    };
    const id = await db.addSession(meta, tr.samples);
    if (feedback && !tr.experiment && !tr.swapped) learn(feedback, tr.type);
    emit('records');
    return id;
  },
  install: null,
};

// 根据行程反馈小步更新左右耳参数（每次变化 ≤10%，始终在上下界内）
function learn(fb, type) {
  const p = state.profile;
  const before = { L: { ...p.L }, R: { ...p.R } };
  let changed = false;
  for (const k of ['L', 'R']) {
    const sc = fb[k];
    const e = p[k];
    if (sc >= 2) {
      e.rateMax = clamp(Math.round(e.rateMax * 0.9 * 2) / 2, ...LIMITS.rateMax);
      e.lead = clamp(e.lead + 2, ...LIMITS.lead);
      if (sc === 3) e.dpComfort = clamp(e.dpComfort - 0.5, ...LIMITS.dpComfort);
      changed = true;
    } else if (sc === 0) {
      const v = clamp(Math.round(e.rateMax * 1.04 * 2) / 2, ...LIMITS.rateMax);
      if (v !== e.rateMax) {
        e.rateMax = v;
        changed = true;
      }
    }
  }
  if (!changed) return;
  p.history.unshift({ t: Date.now(), reason: `${TRIP_TYPES[type].name}反馈 · 左${fb.L} 右${fb.R}`, before, after: { L: { ...p.L }, R: { ...p.R } } });
  p.history = p.history.slice(0, 30);
  saveProfile();
  api.syncProfile();
}

// ---------- 告警提示（主告警风格） ----------
let lastPrompt = 0;
let bannerKey = '';
function checkEvents(s) {
  const el = $('#eventBanner');
  const safety = s.flags & (F.SL | F.SR);
  const r = state.rate;
  let key = '';
  let html = '';
  if (safety) {
    key = 'warn';
    html = `<span class="cap-tag">WARNING</span><div><b>安全泄压已触发</b><small>${s.flags & F.SL ? '左' : ''}${s.flags & F.SR ? '右' : ''}耳压差超过上限，阀门已全开</small></div>`;
  } else if (r > 6) {
    key = 'caut';
    html = `<span class="cap-tag">DESCENT</span><div><b>气压正在升高 · 下降中</b><small>这是最容易耳闷的阶段，可以跟着吞咽教练做</small></div><button class="cap-btn" data-coach>开始</button>`;
  } else if (r < -6) {
    key = 'info';
    html = `<span class="cap-tag">CLIMB</span><div><b>气压正在降低 · 上升中</b><small>系统已按左右耳参数提前开始换气</small></div>`;
  }
  if (!key) {
    key = 'idle';
    html = '<div><b>一切舒适~</b><small>小云正帮你盯着气压，有变化会第一时间提醒你</small></div>';
  }
  if (key !== bannerKey) {
    bannerKey = key;
    el.className = `caution ${key || 'hidden'}`;
    el.innerHTML = html;
  }
  if (key === 'caut' && state.settings.prompts && performance.now() - lastPrompt > 45000) {
    lastPrompt = performance.now();
    navigator.vibrate?.([60, 90, 60]);
  }
}

// ---------- 双耳水球 ----------
function earCard(side) {
  const prm = earParams(side);
  const name = side === 'L' ? '左耳' : '右耳';
  return `
  <div class="orb-card ${side}" data-side="${side}">
    <div class="oc-head"><span class="badge ${side}">${side}</span><b>${name}</b><span class="st ok" data-k="st">舒适</span></div>
    ${orbSVG(side, prm.dpComfort, state.settings.safetyLimit)}
    <div class="oc-read"><b data-k="dp">+0.0</b><small>hPa</small></div>
    <div class="oc-lag done" data-k="lag">已追平 ✓</div>
    <div class="oc-valve"><span>阀门</span><div class="vbar"><i data-k="bar"></i></div><em data-k="duty">0%</em></div>
    <button class="oc-btn" data-sym="${side}">${ICON.ear}<span>${name}闷了</span></button>
  </div>`;
}
function buildGauges() {
  $('#ears').innerHTML = earCard('L') + earCard('R');
}

let lastChart = 0;
let lastTripTick = 0;
let rq = false;
function scheduleRender() {
  if (rq) return;
  rq = true;
  requestAnimationFrame(() => {
    rq = false;
    renderLive();
  });
}

const tripTypeNow = () => {
  if (state.trip) return state.trip.type;
  if (state.settings.source !== 'sim') return 'flight';
  const sc = state.settings.simScenario;
  return sc === 'chamber' ? 'experiment' : sc.startsWith('flight') ? 'flight' : sc;
};

// 显示平滑：按真实时间做指数平滑（τ≈0.8 s），避免座舱小扰动和高倍速播放造成数字闪烁。控制与记录仍用原始数据
const view = { init: false, wall: 0, pAmb: 0, dpL: 0, dpR: 0, dutyL: 0, dutyR: 0, pred: 0, rate: 0 };
function smoothView(s) {
  const now = performance.now();
  const tau = Math.abs(state.rate) < 1 ? 2000 : 800; // 平稳时平滑更强
  const a = view.init ? 1 - Math.exp(-Math.min(1000, now - view.wall) / tau) : 1;
  const pred = s.pAmb + s.predSlope * 30;
  const jump = view.init && Math.abs(s.pAmb - view.pAmb) > 3000; // 场景切换/重置
  const k = jump ? 1 : a;
  view.pAmb += (s.pAmb - view.pAmb) * k;
  view.dpL += (s.dpL - view.dpL) * k;
  view.dpR += (s.dpR - view.dpR) * k;
  view.dutyL += (s.dutyL - view.dutyL) * k;
  view.dutyR += (s.dutyR - view.dutyR) * k;
  view.pred += (pred - view.pred) * k;
  view.rate += (state.rate - view.rate) * k;
  if (!view.init) Object.assign(view, { init: true, pAmb: s.pAmb, dpL: s.dpL, dpR: s.dpR, dutyL: s.dutyL, dutyR: s.dutyR, pred, rate: state.rate });
  view.wall = now;
  return view;
}

// 耳道相对座舱的"追赶"状态：落后（压差与气压变化方向相反）/ 追赶中 / 已追平
function lagText(dpPa) {
  const d = Math.abs(dpPa) / 100;
  const r = state.rate;
  if (d < 0.3) return { text: '已追平 ✓', cls: 'done' };
  if (Math.abs(r) >= 3 && dpPa * r < 0) return { text: `落后座舱约 ${Math.min(999, Math.round((d / Math.abs(r)) * 60))} 秒`, cls: 'lag' };
  return { text: '正在追赶…', cls: 'catch' };
}

function renderLive() {
  const s = state.last;
  const now = performance.now();
  if (state.trip && now - lastTripTick > 500 && V.currentTab() === 'trip') {
    lastTripTick = now;
    V.tickTrip();
  }
  if (!s || V.currentTab() !== 'live') return;
  const qnh = state.settings.qnh;
  const alt = altitude(s.pAmb, qnh);
  const type = tripTypeNow();
  const ph = phaseOf(state.rate, alt, type, true);
  const v = smoothView(s);

  $('#pAmb').textContent = fmt(v.pAmb / 100, 1);
  $('#altv').textContent = Math.round(altitude(v.pAmb, qnh));
  $('#altLabel').textContent = type === 'flight' ? '座舱等效海拔' : '估算海拔';
  $('#rate').textContent = signed(v.rate, 1);
  const dhdp = (44330 / 5.255) * Math.pow(s.pAmb / 100 / qnh, 1 / 5.255 - 1) / qnh;
  $('#vs').textContent = signed(-v.rate * dhdp, 0);
  $('#pred').textContent = fmt(v.pred / 100, 1);

  const pill = $('#phasePill');
  pill.textContent = `${ph.name} · ${ph.code}`;
  pill.dataset.k = ph.key;

  $('#fmaMode').textContent = (TRIP_TYPES[type] || TRIP_TYPES.flight).code;
  const fp = $('#fmaPhase');
  fp.textContent = ph.code;
  fp.className = ph.key === 'down' ? 'amb' : 'grn';
  const fpr = $('#fmaPred');
  fpr.textContent = state.predict ? 'ON' : 'OFF';
  fpr.className = state.predict ? 'mag' : 'wht';
  const safety = s.flags & (F.SL | F.SR);
  const fpt = $('#fmaProt');
  fpt.textContent = safety ? 'VENT' : 'ARMED';
  fpt.className = safety ? 'red blink' : 'grn';

  const limit = state.settings.safetyLimit;
  for (const side of ['L', 'R']) {
    const card = document.querySelector(`.orb-card[data-side="${side}"]`);
    if (!card) continue;
    const dp = v['dp' + side];
    const duty = Math.round(v['duty' + side]);
    const sf = !!(s.flags & (side === 'L' ? F.SL : F.SR));
    const st = statusOf(dp, earParams(side), limit, sf);
    const q = (k) => card.querySelector(`[data-k="${k}"]`);
    q('dp').textContent = signed(dp / 100, 1);
    const lg = lagText(dp);
    q('lag').textContent = lg.text;
    q('lag').className = 'oc-lag ' + lg.cls;
    q('bar').style.width = duty + '%';
    q('duty').textContent = duty + '%';
    setOrb(card, dp, duty, limit);
    const stEl = q('st');
    stEl.textContent = STATUS_TEXT[st];
    stEl.className = 'st ' + st;
    card.dataset.st = st;
  }

  if (now - lastChart > 180) {
    lastChart = now;
    drawLiveCharts();
  }
}

function drawLiveCharts() {
  const live = state.live;
  if (!live.length || V.currentTab() !== 'live') return;
  const last = live[live.length - 1];
  const win = state.win;
  const tMin = last.t - win * 1000;
  let i0 = live.length - 1;
  while (i0 > 0 && live[i0 - 1].t >= tMin) i0--;
  const pts = live.slice(i0);
  const X = (t) => (t - last.t) / 1000;
  const xFmt = (x) => (Math.abs(x) < 0.5 ? '现在' : win > 120 ? `${Math.round(x / 60)}分` : `${Math.round(x)}秒`);
  const c = Math.min(earParams('L').dpComfort, earParams('R').dpComfort);
  const marks = state.trip ? state.trip.markers.filter((m) => m.t + state.trip.t0 >= tMin).map((m) => ({ x: X(m.t + state.trip.t0), label: m.label })) : [];
  drawChart($('#chartDp'), {
    xMin: -win, xMax: 0, minSpan: c * 2 + 1, zero: true, markers: marks,
    band: { y0: -c, y1: c },
    xTicks: [-win, -win / 2, 0], xFmt,
    series: [
      { data: pts.map((s) => [X(s.t), s.dpL / 100]), color: '#3fa0ff', width: 2.4, glow: true },
      { data: pts.map((s) => [X(s.t), s.dpR / 100]), color: '#ff7a6b', width: 2.4, glow: true },
    ],
  });
}

// ---------- 顶栏 ----------
function renderConn() {
  const chip = $('#connChip');
  const src = state.settings.source;
  let cls = 'off';
  let text = 'NO LINK';
  if (src === 'sim') {
    cls = 'sim';
    text = `SIM · ${SCENARIOS[state.trip?.scenario || state.settings.simScenario].name}`;
  } else if (state.connected) {
    cls = 'on';
    text = state.deviceName + (state.battery != null ? ` · ${state.battery}%` : '');
  }
  chip.className = `conn ${cls}`;
  chip.querySelector('span').textContent = text;
}

function renderMode() {
  $('#btnPredict').classList.toggle('on', state.predict);
  $('#predState').textContent = state.predict ? 'ON · 提前调节' : 'OFF · 常规反应';
}

function renderSymCount() {
  const ev = state.trip?.events || [];
  const n = (side) => ev.filter((e) => e.type === 'blocked' && e.side === side).length;
  $('#symCount').textContent = state.trip ? `本航程  L ${n('L')} 次 · R ${n('R')} 次` : '开始航程后可打卡';
}


// ---------- 遮光帘（夜航模式）与滑动切页 ----------
function initShade() {
  const tab = $('#shadeTab');
  const box = $('.win-in');
  let y0 = null;
  let base = 0;
  let cur = 0;
  const set = (v) => {
    cur = v;
    box.style.setProperty('--shpx', v + 'px');
  };
  tab.addEventListener('pointerdown', (e) => {
    y0 = e.clientY;
    base = cur;
    tab.setPointerCapture(e.pointerId);
  });
  tab.addEventListener('pointermove', (e) => {
    if (y0 !== null) set(Math.max(0, Math.min(box.clientHeight * 0.62, base + e.clientY - y0)));
  });
  const end = () => {
    y0 = null;
  };
  tab.addEventListener('pointerup', end);
  tab.addEventListener('pointercancel', end);
  tab.addEventListener('dblclick', () => set(0));
}

function initSwipe() {
  const order = ['live', 'trip', 'ears', 'records'];
  let x0 = 0;
  let y0 = 0;
  let skip = false;
  const main = $('#views');
  main.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    x0 = t.clientX;
    y0 = t.clientY;
    skip = !!e.target.closest('input, .slide, canvas, .shade-tab, .status-row, textarea, select');
  }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (skip || document.getElementById('sheetWrap').hidden === false) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    if (Math.abs(dx) < 80 || Math.abs(t.clientY - y0) > 50) return;
    const i = order.indexOf(V.currentTab()) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < order.length) V.showTab(order[i]);
  }, { passive: true });
}

// ---------- 启动 ----------
function init() {
  fillIcons();
  buildGauges();

  document.querySelector('.tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) V.showTab(b.dataset.tab);
  });
  const WINS = [[60, '1 分钟'], [300, '5 分钟'], [900, '15 分钟']];
  $('.win-in').addEventListener('click', (e) => {
    if (e.target.closest('.shade-tab')) return;
    const i = (WINS.findIndex((w) => w[0] === state.win) + 1) % WINS.length;
    state.win = WINS[i][0];
    $('#winLabel').textContent = `${WINS[i][1]} · 点击切换`;
    navigator.vibrate?.(10);
    drawLiveCharts();
  });
  initShade();
  startScene($('#scene'), () => ({
    active: V.currentTab() === 'live', last: state.last, live: state.live, win: state.win, qnh: state.settings.qnh, rate: state.rate,
  }));
  initSwipe();
  $('#btnPredict').addEventListener('click', () => api.setPredict(!state.predict));
  $('#btnVent').addEventListener('click', () => api.vent());
  $('#btnCoach').addEventListener('click', () => V.openCoach());
  $('#eventBanner').addEventListener('click', (e) => {
    if (e.target.closest('[data-coach]')) V.openCoach();
  });
  $('#btnSettings').addEventListener('click', () => V.openSettings());
  $('#connChip').addEventListener('click', () => {
    if (state.settings.source === 'ble' && !state.connected) api.connectBle();
    else V.openSettings();
  });
  $('#ears').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sym]');
    if (!b) return V.showTab('ears');
    if (api.logEvent('blocked', b.dataset.sym)) {
      b.classList.remove('hit');
      void b.offsetWidth;
      b.classList.add('hit');
      const r = b.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top, 10);
      toast(`已记录：${b.dataset.sym === 'L' ? '左' : '右'}耳闷 · 试试吞咽教练`);
    }
  });

  on('conn', renderConn);
  on('settings', () => {
    renderConn();
    buildGauges();
  });
  on('profile', buildGauges);
  on('trip', () => {
    renderConn();
    renderSymCount();
  });
  on('event', renderSymCount);
  on('mode', () => {
    renderMode();
    buildGauges();
  });
  window.addEventListener('resize', () => drawLiveCharts());
  on('tab', (t) => {
    if (t === 'live') requestAnimationFrame(drawLiveCharts);
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    api.install = e;
    emit('installable');
  });

  V.init(api, fillIcons);
  renderConn();
  renderMode();
  renderSymCount();

  if (state.settings.source === 'sim') {
    sim.setScenario(state.settings.simScenario);
    sim.setSpeed(state.settings.simSpeed);
    sim.start();
  }
  document.addEventListener('visibilitychange', () => {
    if (state.settings.source !== 'sim') return;
    if (document.hidden && !state.trip) sim.stop();
    else sim.start();
  });

  if (!state.settings.onboarded) V.openOnboarding();
  else if (location.hash === '#trip') V.showTab('trip');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (had && !window.__swReloaded) {
        window.__swReloaded = true;
        location.reload();
      }
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
