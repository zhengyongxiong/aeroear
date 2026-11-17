import {
  state, on, emit, saveProfile, saveSettings, fmt, signed, altitude, qnhFromAlt, toast,
  DEFAULT_PROFILE, LIMITS, TRIP_TYPES, phaseOf, fmtDur, fmtDate, resample, corr,
} from './state.js';
import * as db from './store.js';
import { drawChart } from './chart.js';
import { drawTripProfile } from './scene.js';
import { previewResponse } from './sim.js';
import { ICON } from './icons.js';
import { confetti } from './fx.js';
import { bleSupported } from './ble.js';

let api;
let fillIcons;
let tab = 'live';
const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const FB = ['无不适', '轻微', '明显', '疼痛'];
const FB_CODE = ['NIL', 'LGT', 'MOD', 'SEV'];

export function init(a, fi) {
  api = a;
  fillIcons = fi;
  renderTrip();
  renderEars();
  renderRecords();
  on('trip', renderTrip);
  on('mode', () => {
    if (state.trip?.experiment) renderTrip();
    if (!earsEditing) renderEars();
  });
  on('profile', () => {
    if (!earsEditing) renderEars();
  });
  on('records', renderRecords);
  on('settings', () => {
    if (!state.trip) renderTrip();
  });
  on('event', () => {
    if (tab === 'trip') tickTrip(true);
  });
}

export const currentTab = () => tab;
export function showTab(t) {
  tab = t;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + t));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  window.scrollTo(0, 0);
  if (t === 'trip') tickTrip(true);
  if (t === 'ears') requestAnimationFrame(drawPreview);
  emit('tab', t);
}

// ---------- 弹层 ----------
let sheetClose = null;
let closeTimer = null;
export function openSheet(html, { full = false, onClose } = {}) {
  clearTimeout(closeTimer);
  const prev = sheetClose;
  sheetClose = null;
  prev?.();
  const wrap = $('#sheetWrap');
  const sh = $('#sheet');
  sh.className = 'sheet' + (full ? ' full' : '');
  sh.innerHTML = `<div class="grip"></div>${full ? '' : `<button class="icon-btn sheet-x" data-act="close">${ICON.close}</button>`}<div class="sheet-body">${html}</div>`;
  wrap.hidden = false;
  requestAnimationFrame(() => wrap.classList.add('open'));
  sheetClose = onClose || null;
  fillIcons(sh);
  return sh;
}
export function closeSheet() {
  const wrap = $('#sheetWrap');
  wrap.classList.remove('open');
  closeTimer = setTimeout(() => {
    wrap.hidden = true;
    $('#sheet').innerHTML = '';
  }, 260);
  const f = sheetClose;
  sheetClose = null;
  f?.();
}
document.addEventListener('click', (e) => {
  if (e.target.classList?.contains('sheet-backdrop') && !$('#sheet').classList.contains('full')) closeSheet();
  if (e.target.closest?.('[data-act="close"]')) closeSheet();
});

// 滑动确认（滑动出发 / 滑动落地），防止误触；键盘回车同样可触发
function bindSlide(el, done) {
  const knob = el.querySelector('.knob');
  let start = null;
  let max = 0;
  let x = 0;
  const set = (v) => {
    x = v;
    knob.style.transform = `translateX(${v}px)`;
    el.style.setProperty('--p', max ? v / max : 0);
  };
  const finish = () => {
    max = el.clientWidth - knob.offsetWidth - 8;
    set(max);
    el.classList.add('done');
    navigator.vibrate?.(30);
    confetti();
    done();
  };
  knob.addEventListener('pointerdown', (e) => {
    max = el.clientWidth - knob.offsetWidth - 8;
    start = e.clientX - x;
    knob.setPointerCapture(e.pointerId);
    knob.style.transition = '';
  });
  knob.addEventListener('pointermove', (e) => {
    if (start !== null) set(Math.max(0, Math.min(max, e.clientX - start)));
  });
  const up = () => {
    if (start === null) return;
    start = null;
    if (x >= max * 0.86) finish();
    else {
      knob.style.transition = 'transform .25s';
      set(0);
    }
  };
  knob.addEventListener('pointerup', up);
  knob.addEventListener('pointercancel', up);
  knob.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish();
  });
}
const slideHTML = (text, cls = '') =>
  `<div class="slide ${cls}"><div class="slide-fill"></div><span class="slide-text">${text}<em>›››</em></span><button class="knob" aria-label="${text}">${ICON.plane}</button></div>`;

// 背面视角头像：与佩戴者左右一致，避免正面视角的镜像误解
function headSVG(cls = '') {
  return `<svg viewBox="0 0 220 180" class="head ${cls}">
    <defs><radialGradient id="hg" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dde8f7"/></radialGradient></defs>
    <rect x="92" y="138" width="36" height="42" rx="10" class="h-neck"/>
    <ellipse cx="110" cy="84" rx="56" ry="66" fill="url(#hg)" class="h-skull"/>
    <path d="M58 70 C62 28 158 28 162 70 C150 52 70 52 58 70 Z" class="h-hair"/>
    <path d="M110 22 V146" class="h-mid"/>
    <g class="ear-hit L" data-ear="L"><circle cx="46" cy="92" r="32" class="hit"/>
      <path d="M56 70 C38 66 32 84 36 100 C39 112 48 118 56 114 Z" class="ear-shape"/>
      <text x="22" y="62" class="ear-lbl">L</text></g>
    <g class="ear-hit R" data-ear="R"><circle cx="174" cy="92" r="32" class="hit"/>
      <path d="M164 70 C182 66 188 84 184 100 C181 112 172 118 164 114 Z" class="ear-shape"/>
      <text x="198" y="62" class="ear-lbl">R</text></g>
  </svg>`;
}

// 耳部结构示意（医生审定）：说明设备调节的是哪一段
function earDiagramSVG() {
  return `<svg viewBox="0 0 320 150" class="ear-diag">
    <rect x="8" y="58" width="122" height="34" rx="6" class="d-canal"/>
    <rect x="20" y="52" width="26" height="46" rx="8" class="d-plug"/>
    <path d="M134 40 Q144 75 134 110" class="d-drum"/>
    <ellipse cx="190" cy="75" rx="46" ry="38" class="d-middle"/>
    <path d="M222 100 Q262 120 310 138" class="d-tube"/>
    <text x="70" y="48" class="d-t c">外耳道 · 设备调节这里</text>
    <text x="33" y="112" class="d-t">耳塞</text>
    <text x="136" y="132" class="d-t">鼓膜</text>
    <text x="190" y="79" class="d-t c">中耳</text>
    <text x="252" y="102" class="d-t">咽鼓管</text>
    <text x="252" y="116" class="d-t s">吞咽时打开</text>
  </svg>`;
}

// ---------- 安全简报（首次引导） ----------
export function openOnboarding() {
  let step = 0;
  const steps = [
    {
      tag: 'BRIEFING 01',
      title: '耳闷从哪里来',
      body: `${earDiagramSVG()}
        <p>鼓膜外侧是<b>外耳道</b>，内侧是<b>中耳</b>。中耳靠咽鼓管换气，吞咽时才会打开。气压变得太快、咽鼓管来不及跟上，鼓膜两侧就会出现压差，让人觉得耳闷。</p>
        <p>AeroEar 预测接下来的气压变化，<b>分别</b>控制左右耳塞的换气节奏，让外耳道气压按你每只耳朵能接受的速度变化。</p>`,
    },
    {
      tag: 'BRIEFING 02',
      title: '使用前请确认',
      body: `<div class="brief-grid">
        <div class="bg-item risk">${ICON.shield}<b>先咨询医生</b><small>鼓膜穿孔或置管 · 中耳炎、外耳道炎急性期 · 近期耳部手术 · 严重鼻塞</small></div>
        <div class="bg-item risk">${ICON.info}<b>立即停用并就医</b><small>耳痛加重 · 听力下降 · 耳鸣 · 眩晕 · 耳内流液</small></div>
        <div class="bg-item">${ICON.ear}<b>舒适辅助设备</b><small>不是医疗器械，不能诊断或治疗疾病</small></div>
        <div class="bg-item">${ICON.wind}<b>不用于潜水</b><small>不适用于任何水下场景</small></div></div>`,
    },
    {
      tag: 'BRIEFING 03',
      title: '三个好习惯',
      body: `<div class="brief-steps">
        <div><span>1</span><b>降落前打开「吞咽教练」</b><small>跟着节奏吞咽、打哈欠、活动下颌</small></div>
        <div><span>2</span><b>闷了就打卡</b><small>哪边闷点哪边，系统据此调整那只耳朵</small></div>
        <div><span>3</span><b>不要用力捏鼻鼓气</b><small>鼻塞时尤其危险，可能伤及中耳</small></div></div>`,
    },
  ];
  const render = () => {
    const s = steps[step];
    const last = step === steps.length - 1;
    const sh = openSheet(
      `<div class="onb">
        <div class="onb-top"><span class="eyebrow">SAFETY CARD · 安全须知</span><span class="eyebrow mag">${s.tag}</span></div>
        <div class="dots">${steps.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
        <h2>${s.title}</h2>
        <div class="onb-body">${s.body}</div>
        ${step === 1 ? '<label class="check"><input type="checkbox" id="onbAgree"><span>我已阅读并了解以上内容</span></label>' : ''}
        <div class="onb-actions">
          ${step ? '<button class="btn ghost" data-a="back">上一步</button>' : '<span></span>'}
          <button class="btn primary" data-a="next">${last ? '完成简报' : '继续'}</button>
        </div>
      </div>`,
      { full: true },
    );
    sh.querySelector('[data-a="next"]').onclick = () => {
      if (step === 1 && !$('#onbAgree').checked) {
        toast('请先勾选确认');
        return;
      }
      if (last) {
        state.settings.onboarded = true;
        saveSettings();
        closeSheet();
        if (!state.profile.questionnaire) setTimeout(openQuestionnaire, 350);
      } else {
        step++;
        render();
      }
    };
    const back = sh.querySelector('[data-a="back"]');
    if (back) back.onclick = () => {
      step--;
      render();
    };
  };
  render();
}

// ---------- 吞咽教练 ----------
const CUES = [
  ['吞咽', '空咽一次，或小口喝水'],
  ['打哈欠', '嘴巴张大，像打哈欠一样'],
  ['活动下颌', '下巴慢慢前后、左右移动'],
  ['吞咽', '再吞咽一次'],
  ['放松呼吸', '用鼻子平稳呼吸，肩膀放松'],
];
export function openCoach() {
  const TOTAL = 60;
  const CUE_S = 6;
  let el = 0;
  let idx = -1;
  let timer = null;
  const sh = openSheet(`
    <div class="coach">
      <div class="onb-top"><span class="eyebrow">EQUALIZATION COACH</span><span class="eyebrow mag" id="cRemain">60s</span></div>
      <h2>吞咽教练</h2>
      <div class="coach-ring" id="cRing">
        <svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="88" class="cr-track"/><circle cx="100" cy="100" r="88" class="cr-prog" id="cProg" stroke-dasharray="553" stroke-dashoffset="553"/></svg>
        <div class="cr-pulse"></div><div class="cr-pulse d2"></div>
        <div class="cr-text"><b id="cCue">准备</b><small id="cSub">跟着节奏做，每 6 秒换一个动作</small></div>
      </div>
      <div class="coach-live">
        <div class="L"><span class="badge L">L</span><b id="cL">--</b><small>hPa</small></div>
        <div class="R"><span class="badge R">R</span><b id="cR">--</b><small>hPa</small></div>
      </div>
      <p class="muted center small">哪边耳朵"啵"一下通了，就点对应按钮</p>
      <div class="row2">
        <button class="btn relief L" data-relief="L">${ICON.ear}左耳通了</button>
        <button class="btn relief R" data-relief="R">${ICON.ear}右耳通了</button>
      </div>
      <div class="row2">
        <button class="btn ghost" id="cVent">${ICON.wind}疼痛 · 泄压</button>
        <button class="btn ghost" data-act="close">结束</button>
      </div>
      <p class="footnote">不要用力捏鼻鼓气。若疼痛持续，请取下耳塞并就医。</p>
    </div>`, { full: true, onClose: () => clearInterval(timer) });
  const ring = $('#cRing', sh);
  timer = setInterval(() => {
    el += 0.25;
    const i = Math.floor(el / CUE_S) % CUES.length;
    if (i !== idx) {
      idx = i;
      $('#cCue', sh).textContent = CUES[i][0];
      $('#cSub', sh).textContent = CUES[i][1];
      ring.classList.remove('beat');
      void ring.offsetWidth;
      ring.classList.add('beat');
      navigator.vibrate?.(50);
    }
    $('#cProg', sh).style.strokeDashoffset = 553 * (1 - Math.min(1, el / TOTAL));
    $('#cRemain', sh).textContent = `${Math.max(0, Math.ceil(TOTAL - el))}s`;
    const s = state.last;
    if (s) {
      $('#cL', sh).textContent = signed(s.dpL / 100, 1);
      $('#cR', sh).textContent = signed(s.dpR / 100, 1);
    }
    if (el >= TOTAL) {
      clearInterval(timer);
      $('#cCue', sh).textContent = '完成';
      $('#cSub', sh).textContent = '还闷的话可以再做一轮';
      ring.classList.remove('beat');
    }
  }, 250);
  sh.querySelectorAll('[data-relief]').forEach((b) => (b.onclick = () => {
    const ok = api.logEvent('relief', b.dataset.relief);
    b.classList.add('hit');
    const r = b.getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top, 22);
    toast(ok ? `已记录：${b.dataset.relief === 'L' ? '左' : '右'}耳通了` : '很好！开始航程后可记入日志');
  }));
  $('#cVent', sh).onclick = () => api.vent();
}

// ---------- 航程 ----------
const MARKERS = [
  [1, '开始减压'],
  [2, '保持'],
  [3, '开始回压'],
  [9, '异常'],
];
const flap = (txt, delay = 0) => [...txt].map((ch, i) => `<i style="animation-delay:${delay + i * 45}ms">${ch === ' ' ? '&nbsp;' : esc(ch)}</i>`).join('');
const phaseKeyOf = (type) => (s) => phaseOf(s.sr ?? (s.predSlope * 60) / 100, altitude(s.pAmb, state.settings.qnh), type).key;

export function renderTrip() {
  const el = $('#view-trip');
  const tr = state.trip;
  if (!tr) {
    const types = Object.entries(TRIP_TYPES).filter(([k]) => k !== 'experiment' || state.settings.experiment);
    el.innerHTML = `
      <div class="page-head"><span class="eyebrow">DEPARTURES</span><h2>选择航段</h2><p>选好场景后滑动出发，系统会切换对应的预测策略。</p></div>
      <div class="panel fids">
        <div class="fids-row hdr"><span>代码</span><span>场景</span><span>目标</span><span>状态</span></div>
        ${types.map(([k, t], r) => `
          <button class="fids-row" data-type="${k}">
            <span class="flap code">${flap(t.code, r * 120)}</span>
            <span class="f-name">${t.name}</span>
            <span class="f-dest">${t.dest}</span>
            <span class="flap status ${k === 'experiment' ? 'amb' : ''}">${flap(k === 'experiment' ? 'TEST' : 'BOARD', r * 120 + 200)}</span>
          </button>`).join('')}
      </div>
      ${state.settings.experiment ? '' : '<p class="footnote">需要做真空箱对比实验？在 设置 → 实验模式 中开启。</p>'}
      <div class="panel tip">
        <span class="ti">${ICON.info}</span>
        <div><b>乘机建议</b><p>登机后就出发，系统全程待命；下降开始前约 30 分钟最关键。手机可开飞行模式，蓝牙保持开启。</p></div>
      </div>`;
    el.querySelectorAll('.fids-row[data-type]').forEach((b) => (b.onclick = () => openBoarding(b.dataset.type)));
    return;
  }
  const t = TRIP_TYPES[tr.type];
  el.innerHTML = `
    <div class="panel hud">
      <div class="hud-top"><span class="code-tag">${t.code}</span><b>${esc(tr.flightNo || (tr.experiment ? '实验 · ' + api.scenarios[tr.scenario].name : t.name))}</b><span class="rec">REC</span></div>
      <canvas id="tripProfile" class="chart"></canvas>
      <div class="hud-legend"><span><i class="ph up"></i>上升</span><span><i class="ph level"></i>平稳</span><span><i class="ph down"></i>下降</span><span><i class="dot"></i>闷</span><span><i class="sq"></i>通</span></div>
      <div class="hud-grid">
        <div><small>ELAPSED · ${tr.source === 'sim' ? '模拟时间' : '时长'}</small><b id="tripTimer">00:00</b></div>
        <div><small>PHASE · 阶段</small><b id="tripPhase" class="grn">--</b></div>
        <div class="L"><small>L 峰值压差</small><b id="tripPkL">--</b></div>
        <div class="R"><small>R 峰值压差</small><b id="tripPkR">--</b></div>
      </div>
    </div>
    <div class="panel evlog">
      <div class="panel-title"><span>EVENT LOG · 打卡记录</span><span class="muted">在仪表页点「耳闷了」</span></div>
      <div id="evList"></div>
    </div>
    ${tr.experiment ? `
    <div class="panel exp">
      <div class="panel-title"><span>TEST CONTROL · 实验控制</span></div>
      <div class="toggle-row"><div><b>预测调节</b><small>A/B：同一曲线开、关各跑一次</small></div>
        <button class="switch ${state.predict ? 'on' : ''}" data-x="predict"><i></i></button></div>
      <div class="toggle-row"><div><b>左右参数对调</b><small>检验两条压力曲线是否随之交换</small></div>
        <button class="switch ${state.swapped ? 'on' : ''}" data-x="swap"><i></i></button></div>
      <p class="warn-note">运行中切换会混入同一条记录，建议每次只改一个条件。</p>
      <div class="marker-row">${MARKERS.map(([c, l]) => `<button class="btn chip-btn" data-m="${c}">${l}</button>`).join('')}</div>
      <textarea id="expNote" rows="2" placeholder="实验备注，如：箱体编号、耳道模型、温度…"></textarea>
    </div>` : `
    <button class="panel coach-cta" id="tripCoach"><span class="ti">${ICON.ear}</span><div><b>吞咽教练</b><small>下降阶段跟着做，60 秒</small></div>${ICON.chevron}</button>`}
    ${slideHTML(tr.experiment ? '滑动结束实验' : '滑动落地 · 结束航程', 'land')}`;
  bindSlide(el.querySelector('.slide'), endTrip);
  el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => api.marker(+b.dataset.m, b.textContent)));
  const sp = el.querySelector('[data-x="predict"]');
  if (sp) sp.onclick = () => api.setPredict(!state.predict);
  const sw = el.querySelector('[data-x="swap"]');
  if (sw) sw.onclick = () => api.setSwapped(!state.swapped);
  const cc = el.querySelector('#tripCoach');
  if (cc) cc.onclick = openCoach;
  tickTrip(true);
}

let evCount = -1;
export function tickTrip(force) {
  const tr = state.trip;
  if (!tr || !$('#tripTimer')) return;
  const last = state.last;
  if (tr.t0 != null && last) $('#tripTimer').textContent = fmtDur((last.t - tr.t0) / 1000);
  if (last) {
    const ph = phaseOf(state.rate, altitude(last.pAmb, state.settings.qnh), tr.type, true);
    const p = $('#tripPhase');
    p.textContent = `${ph.code} ${ph.name}`;
    p.className = ph.key === 'down' ? 'amb' : 'grn';
  }
  let pL = 0, pR = 0;
  for (const s of tr.samples) {
    pL = Math.max(pL, Math.abs(s.dpL));
    pR = Math.max(pR, Math.abs(s.dpR));
  }
  $('#tripPkL').textContent = fmt(pL / 100, 1);
  $('#tripPkR').textContent = fmt(pR / 100, 1);
  drawTripProfile($('#tripProfile'), {
    samples: tr.samples, events: tr.events, qnh: state.settings.qnh, phaseOf: phaseKeyOf(tr.type), plane: true,
    minSpan: tr.source === 'sim' ? (api.scenarios[tr.scenario].segs.reduce((a, s) => a + s[0], 0)) : 600,
  });
  if (force || tr.events.length !== evCount) {
    evCount = tr.events.length;
    $('#evList').innerHTML = eventListHTML(tr.events);
  }
}

function eventListHTML(events) {
  if (!events.length) return '<p class="muted small">暂无打卡。觉得耳闷时点一下，医生最需要这类实时记录。</p>';
  return events.slice().reverse().slice(0, 12).map((e) => `
    <div class="ev ${e.side}"><span class="ev-t">${fmtDur(e.t / 1000)}</span><span class="badge ${e.side}">${e.side}</span>
      <b>${e.type === 'blocked' ? '耳闷' : '通了'}</b><span class="ev-ph">${e.phase}</span><span class="ev-dp">ΔP ${signed((e.side === 'L' ? e.dpL : e.dpR) / 100, 1)}</span></div>`).join('');
}

const rateWord = (v) => (v < 5 ? '很慢' : v < 8 ? '较慢' : v < 12 ? '常规' : v < 15 ? '较快' : '很快');
const dpWord = (v) => (v <= 2 ? '很敏感' : v <= 3 ? '较敏感' : v <= 5 ? '一般' : '耐受');

function openBoarding(type) {
  if (type === 'experiment') return openExperiment();
  const t = TRIP_TYPES[type];
  const p = state.profile;
  const sh = openSheet(`
    <div class="bpass">
      <div class="bp-top"><span>${ICON.plane}AEROEAR</span><span>BOARDING PASS · 登机牌</span></div>
      <div class="bp-route">
        <div><b>GND</b><small>出发</small></div>
        <div class="bp-line"><i></i>${ICON.plane}<i></i></div>
        <div><b>${t.code}</b><small>${t.dest}</small></div>
      </div>
      <div class="bp-grid">
        <label style="grid-column:1/-1"><small>航班号 FLIGHT</small><input id="bpNo" maxlength="10" placeholder="可选，如 CA1501" autocomplete="off"></label>
        ${type === 'flight' && state.settings.source === 'sim' ? `<label style="grid-column:1/-1"><small>模拟片段 SEGMENT</small>
          <select id="bpSeg" class="bp-sel"><option value="flightDescent">下降段 · 约 28 分钟，20× 播放（推荐）</option><option value="flightClimb">爬升段 · 约 25 分钟，20× 播放</option><option value="flight">全程 · 约 2.2 小时，60× 播放</option></select></label>` : ''}
        <div class="L"><small>左耳 SEAT L</small><b>${rateWord(p.L.rateMax)} · ${dpWord(p.L.dpComfort)}</b></div>
        <div class="R"><small>右耳 SEAT R</small><b>${rateWord(p.R.rateMax)} · ${dpWord(p.R.dpComfort)}</b></div>
        <div><small>预测 PRED</small><b class="${state.predict ? 'mag' : ''}">${state.predict ? 'ON' : 'OFF'}</b></div>
        <div><small>吞咽提醒</small><b>${state.settings.prompts ? 'ON' : 'OFF'}</b></div>
      </div>
      <div class="bp-perf"></div>
      <div class="bp-stub"><div class="barcode"></div><span>${t.name} · ${t.desc}</span></div>
    </div>
    ${slideHTML('滑动出发')}`);
  bindSlide(sh.querySelector('.slide'), async () => {
    const flightNo = $('#bpNo', sh).value.trim().toUpperCase();
    const seg = $('#bpSeg', sh)?.value;
    setTimeout(closeSheet, 250);
    const ok = await api.startTrip(type, { flightNo, ...(seg ? { scenario: seg } : {}) });
    if (ok) toast(`${flightNo || t.name} 已出发 · 祝旅途舒适`);
  });
}

function openExperiment() {
  const isSim = state.settings.source === 'sim';
  const sh = openSheet(`
    <span class="eyebrow">TEST SETUP</span>
    <h2>新建实验记录</h2>
    <p class="muted">每次记录保持同一气压曲线，只改变一个条件（预测开/关，或左右对调）。</p>
    ${isSim ? `<label class="field"><span>模拟气压曲线</span>
      <select id="expSc">${Object.entries(api.scenarios).map(([k, s]) => `<option value="${k}" ${k === 'chamber' ? 'selected' : ''}>${s.name} · ${s.desc}</option>`).join('')}</select></label>
      <label class="field"><span>时间倍速</span><select id="expSp">${[1, 5, 10, 20, 60, 200].map((v) => `<option value="${v}">${v}×</option>`).join('')}</select></label>` :
      '<p class="muted">数据来自真实设备与真空箱，请在开始减压时点「开始减压」标记。</p>'}
    <div class="toggle-row"><div><b>预测调节</b></div><button class="switch ${state.predict ? 'on' : ''}" data-x="p"><i></i></button></div>
    <div class="toggle-row"><div><b>左右参数对调</b></div><button class="switch ${state.swapped ? 'on' : ''}" data-x="s"><i></i></button></div>
    <button class="btn primary block" id="expGo">开始记录</button>`);
  sh.querySelector('[data-x="p"]').onclick = (e) => {
    api.setPredict(!state.predict);
    e.currentTarget.classList.toggle('on', state.predict);
  };
  sh.querySelector('[data-x="s"]').onclick = (e) => {
    api.setSwapped(!state.swapped);
    e.currentTarget.classList.toggle('on', state.swapped);
  };
  sh.querySelector('#expGo').onclick = async () => {
    const scenario = isSim ? $('#expSc').value : 'chamber';
    const speed = isSim ? +$('#expSp').value : undefined;
    closeSheet();
    const ok = await api.startTrip('experiment', { scenario, speed });
    if (ok) toast('实验记录已开始');
  };
}

async function endTrip() {
  const note = $('#expNote')?.value || '';
  const tr = api.stopTrip();
  if (tr.experiment) {
    const id = await api.saveTrip(tr, null, note);
    if (id) {
      toast('实验记录已保存');
      showTab('records');
    }
    return;
  }
  openFeedback(tr);
}

// 落地反馈：点后脑勺示意图上的耳朵切换不适程度，按打卡次数预填
function openFeedback(tr) {
  const cnt = (side) => tr.events.filter((e) => e.type === 'blocked' && e.side === side).length;
  const pre = (n) => (n >= 2 ? 2 : n);
  const fb = { L: pre(cnt('L')), R: pre(cnt('R')) };
  const prefilled = cnt('L') + cnt('R') > 0;
  const sh = openSheet(`
    <span class="eyebrow">ARRIVAL · 落地</span>
    <h2>这次耳朵感觉如何？</h2>
    <p class="muted">点击耳朵切换程度（从后方看，与你的左右一致）${prefilled ? '<br><span class="mag">已根据飞行中的打卡预填</span>' : ''}</p>
    <div class="fb-head">${headSVG('fb')}</div>
    <div class="fb-scale">${FB.map((t, i) => `<span class="lv${i}"><i></i>${t}</span>`).join('')}</div>
    <div class="fb-read"><div class="L"><span class="badge L">L</span><b data-fb="L"></b></div><div class="R"><span class="badge R">R</span><b data-fb="R"></b></div></div>
    <textarea id="fbNote" rows="2" placeholder="哪个阶段最难受？（可选）"></textarea>
    <div class="row2"><button class="btn ghost" id="fbSkip">跳过</button><button class="btn primary" id="fbSave">保存日志</button></div>`);
  const paint = () => {
    for (const k of ['L', 'R']) {
      const g = sh.querySelector(`.ear-hit.${k}`);
      g.setAttribute('class', `ear-hit ${k} lv${fb[k]}`);
      sh.querySelector(`[data-fb="${k}"]`).textContent = `${FB_CODE[fb[k]]} · ${FB[fb[k]]}`;
    }
  };
  sh.querySelectorAll('.ear-hit').forEach((g) => g.addEventListener('click', () => {
    const k = g.dataset.ear;
    fb[k] = (fb[k] + 1) % 4;
    navigator.vibrate?.(15);
    paint();
  }));
  paint();
  const done = async (useFb) => {
    const n = $('#fbNote').value;
    closeSheet();
    const id = await api.saveTrip(tr, useFb ? fb : null, n);
    if (!id) return;
    if (useFb && (fb.L === 3 || fb.R === 3)) {
      setTimeout(() => openSheet(`
        <div class="alert risk">${ICON.shield}<div><b>关于耳痛</b>
        <p>乘机后的轻微耳闷通常数小时内缓解。如果耳痛持续，或出现听力下降、耳鸣、眩晕、耳内流液，请尽快到耳鼻喉科就诊。</p></div></div>
        <p class="muted">系统已下调该侧耳的换气速率，并提前了准备时间。</p>
        <button class="btn primary block" data-act="close">我知道了</button>`), 320);
    } else {
      toast(useFb ? '已保存，参数已根据反馈更新' : '航程已保存');
      confetti();
    }
    showTab('records');
  };
  $('#fbSave', sh).onclick = () => done(true);
  $('#fbSkip', sh).onclick = () => done(false);
}

// ---------- 双耳设定 ----------
let earsEditing = false;
let earSel = 'L';
const KEYS = [
  ['rateMax', '适应速度', 0.5, '耳道气压最快多快跟上外界。越慢越温和，但压差会稍大'],
  ['dpComfort', '压差耐受', 0.5, '这个范围内感觉舒适。数值越小代表越敏感'],
  ['lead', '提前准备', 1, '预测到气压变化后，提前多久开始换气'],
];
const labelFor = (key, v) =>
  key === 'rateMax' ? `${rateWord(v)} · ${v} hPa/min` : key === 'dpComfort' ? `${dpWord(v)} · ±${v} hPa` : `${v} 秒`;
const pct = (key, v) => ((v - LIMITS[key][0]) / (LIMITS[key][1] - LIMITS[key][0])) * 100;

function compareBars(p) {
  return KEYS.map(([k, n]) => `
    <div class="cbar"><span>${n}</span>
      <div class="cb-track"><i class="L" style="width:${pct(k, p.L[k])}%"></i></div>
      <div class="cb-track"><i class="R" style="width:${pct(k, p.R[k])}%"></i></div></div>`).join('');
}

export function renderEars() {
  const el = $('#view-ears');
  const p = state.profile;
  const e = p[earSel];
  el.innerHTML = `
    <div class="page-head"><span class="eyebrow">CREW PROFILE</span><h2>双耳设定</h2><p>点击耳朵选择要调整的一侧。系统会根据每次反馈小步调整，每次不超过 10%。</p></div>
    ${state.swapped ? '<div class="caution info"><span class="cap-tag">TEST</span><div><b>实验中：左右参数已对调</b><small>设备当前用右耳参数控制左耳，反之亦然</small></div></div>' : ''}
    <div class="panel crew">
      <div class="crew-head">${headSVG('sel-' + earSel)}<p class="muted small center">从后方看 · 与你的左右一致</p></div>
      <div class="crew-cmp">
        <div class="cmp-h"><span></span><span class="L">L ${rateWord(p.L.rateMax)}</span><span class="R">R ${rateWord(p.R.rateMax)}</span></div>
        <div id="cmpBars">${compareBars(p)}</div>
      </div>
    </div>
    <div class="panel editor ${earSel}">
      <div class="ed-head"><div class="seg" id="earSeg"><button data-s="L" class="${earSel === 'L' ? 'on' : ''}">左耳 L</button><button data-s="R" class="${earSel === 'R' ? 'on' : ''}">右耳 R</button></div>
        <span class="tag" id="edTag">${dpWord(e.dpComfort)} · ${rateWord(e.rateMax)}</span></div>
      ${KEYS.map(([k, n, st, hint]) => `
        <div class="slider-row">
          <div class="sr-top"><b>${n}</b><span data-v="${k}">${labelFor(k, e[k])}</span></div>
          <input type="range" min="${LIMITS[k][0]}" max="${LIMITS[k][1]}" step="${st}" value="${e[k]}" data-key="${k}" class="${earSel}">
          <small>${hint}</small></div>`).join('')}
    </div>
    <div class="panel preview">
      <div class="panel-title"><span>RESPONSE PREVIEW · 响应预演</span><span class="muted">标准下降 300 ft/min</span></div>
      <canvas id="pv" class="chart small"></canvas>
      <div class="pv-read" id="pvRead"></div>
      <ul class="pv-note" id="pvNote"></ul>
      <p class="muted small">用当前参数模拟客机最后 8 分钟的典型下降（座舱 300 ft/min，约 10 hPa/min），看左右耳塞内外压差会怎样变化。曲线越平缓越舒适，峰值不应超过你的压差耐受太多。</p>
    </div>
    <div class="action-grid">
      <button class="btn ctl" id="btnQ">${ICON.sparkle}<b>问卷评估</b><small>${p.questionnaire ? '重新评估' : '约 1 分钟'}</small></button>
      <button class="btn ctl" id="btnSwapP">${ICON.swap}<b>左右互换</b><small>交换两侧参数</small></button>
      <button class="btn ctl" id="btnResetP">${ICON.trash}<b>恢复默认</b><small>清除学习结果</small></button>
    </div>
    <div class="panel list">
      <div class="panel-title"><span>LEARNING LOG · 学习记录</span></div>
      ${p.history.length ? p.history.slice(0, 10).map((h) => `
        <div class="hist"><div><b>${esc(h.reason)}</b><small>${fmtDate(h.t)}</small></div>
          <div class="hist-v"><span class="L">L ${h.before.L.rateMax}→${h.after.L.rateMax}</span><span class="R">R ${h.before.R.rateMax}→${h.after.R.rateMax}</span></div></div>`).join('')
        : '<p class="muted small">还没有记录。完成一次航程并反馈后，这里会显示参数的变化。</p>'}
    </div>`;

  const select = (s) => {
    earSel = s;
    renderEars();
    requestAnimationFrame(drawPreview);
  };
  el.querySelectorAll('.crew .ear-hit').forEach((g) => g.addEventListener('click', () => select(g.dataset.ear)));
  el.querySelectorAll('#earSeg button').forEach((b) => (b.onclick = () => select(b.dataset.s)));

  let syncTimer;
  el.querySelectorAll('input[type=range]').forEach((inp) => {
    inp.oninput = () => {
      earsEditing = true;
      const v = +inp.value;
      state.profile[earSel][inp.dataset.key] = v;
      el.querySelector(`[data-v="${inp.dataset.key}"]`).textContent = labelFor(inp.dataset.key, v);
      el.querySelector('#edTag').textContent = `${dpWord(state.profile[earSel].dpComfort)} · ${rateWord(state.profile[earSel].rateMax)}`;
      el.querySelector('#cmpBars').innerHTML = compareBars(state.profile);
      schedulePreview();
    };
    inp.onchange = () => {
      saveProfile();
      earsEditing = false;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => api.syncProfile(), 300);
    };
  });
  $('#btnQ').onclick = openQuestionnaire;
  $('#btnSwapP').onclick = () => {
    const { L, R } = state.profile;
    state.profile.L = R;
    state.profile.R = L;
    pushHistory('手动左右互换');
    saveProfile();
    api.syncProfile();
    toast('已交换左右耳参数');
  };
  $('#btnResetP').onclick = () => {
    if (!confirm('恢复默认参数并清除学习记录？')) return;
    const d = structuredClone(DEFAULT_PROFILE);
    d.version = state.profile.version;
    state.profile = d;
    saveProfile();
    api.syncProfile();
    toast('已恢复默认');
  };
  if (tab === 'ears') requestAnimationFrame(drawPreview);
}

let pvPending = false;
function schedulePreview() {
  if (pvPending) return;
  pvPending = true;
  requestAnimationFrame(() => {
    pvPending = false;
    drawPreview();
  });
}

function drawPreview() {
  const cv = $('#pv');
  if (!cv || !cv.clientWidth) return;
  const p = state.profile;
  const r = previewResponse({ L: p.L, R: p.R }, state.settings.safetyLimit * 100);
  const c = Math.min(p.L.dpComfort, p.R.dpComfort);
  drawChart(cv, {
    xMin: 0, xMax: r.t[r.t.length - 1], zero: true, minSpan: c * 2 + 1,
    band: { y0: -c, y1: c, color: 'rgba(18,184,134,0.12)' },
    xFmt: (x) => `${Math.round(x / 60)}M`, xTicks: [0, 120, 240, r.t[r.t.length - 1]],
    series: [
      { data: r.t.map((t, i) => [t, r.L[i] / 100]), color: '#3fa0ff', width: 2, glow: true },
      { data: r.t.map((t, i) => [t, r.R[i] / 100]), color: '#ff7a6b', width: 2, glow: true },
    ],
  });
  const peak = (a) => Math.max(...a.map(Math.abs)) / 100;
  const over = (a, cm) => a.filter((v) => Math.abs(v) / 100 > cm).length;
  $('#pvRead').innerHTML = ['L', 'R'].map((k) => `
    <div class="${k}"><span class="badge ${k}">${k}</span><div><small>峰值压差</small><b>${fmt(peak(r[k]), 1)}<i> hPa</i></b></div>
      <div><small>超出耐受</small><b>${over(r[k], p[k].dpComfort)}<i> 秒</i></b></div></div>`).join('');
  // 医生视角解读：超出耐受时间过长说明这一侧换气太慢；峰值接近安全上限需警惕
  const notes = ['L', 'R'].map((k) => {
    const name = k === 'L' ? '左耳' : '右耳';
    const o = over(r[k], p[k].dpComfort);
    if (peak(r[k]) > state.settings.safetyLimit * 0.75) return `<li class="risk">${name}峰值接近安全上限，建议提高适应速度</li>`;
    if (o > 120) return `<li class="warn">${name}在常规下降中会持续 ${Math.round(o / 60)} 分钟以上超出耐受，可适当提高适应速度或提前准备时间</li>`;
    if (o > 30) return `<li class="warn">${name}会短时超出耐受（约 ${o} 秒），下降时配合吞咽教练</li>`;
    return `<li class="ok">${name}在常规下降中基本保持在舒适带内</li>`;
  });
  $('#pvNote').innerHTML = notes.join('');
}

function pushHistory(reason, before) {
  const p = state.profile;
  const b = before || { L: { ...p.R }, R: { ...p.L } };
  p.history.unshift({ t: Date.now(), reason, before: b, after: { L: { ...p.L }, R: { ...p.R } } });
  p.history = p.history.slice(0, 30);
}

// 问卷 → 初始参数（医生与乘客代表共同拟定）
const QUESTIONS = [
  { k: 'side', q: '坐飞机时，哪边耳朵更容易闷？', o: ['左耳', '右耳', '两边都会', '都不太明显'] },
  { k: 'recover', q: '耳闷之后，通常多久能缓解？', o: ['1 分钟内', '1–5 分钟', '5 分钟以上或落地后'] },
  { k: 'phase', q: '起飞和降落，哪个阶段更难受？', o: ['降落', '起飞', '差不多'] },
  { k: 'nose', q: '平时容易鼻塞或过敏吗？', o: ['经常', '偶尔', '很少'] },
  { k: 'pain', q: '以前坐飞机出现过耳痛吗？', o: ['有过', '没有'] },
];

export function openQuestionnaire() {
  const ans = {};
  let i = 0;
  const render = () => {
    const q = QUESTIONS[i];
    const sh = openSheet(`
      <div class="quiz">
        <div class="progress"><i style="width:${(i / QUESTIONS.length) * 100}%"></i></div>
        <span class="eyebrow">PREFLIGHT CHECK ${i + 1} / ${QUESTIONS.length}</span>
        <h2>${q.q}</h2>
        <div class="opts">${q.o.map((t, j) => `<button class="opt" data-j="${j}"><span>${String.fromCharCode(65 + j)}</span>${t}</button>`).join('')}</div>
        ${i ? '<button class="btn ghost" id="qBack">上一题</button>' : ''}
      </div>`);
    sh.querySelectorAll('.opt').forEach((b) => (b.onclick = () => {
      ans[q.k] = +b.dataset.j;
      if (++i < QUESTIONS.length) render();
      else finishQuiz(ans);
    }));
    const back = sh.querySelector('#qBack');
    if (back) back.onclick = () => {
      i--;
      render();
    };
  };
  render();
}

function finishQuiz(a) {
  const base = { rateMax: 10, dpComfort: 4, lead: 8 };
  if (a.recover === 0) base.rateMax = 12;
  if (a.recover === 1) base.rateMax = 9;
  if (a.recover === 2) {
    base.rateMax = 6;
    base.lead += 6;
  }
  if (a.nose === 0) {
    base.rateMax *= 0.85;
    base.lead += 4;
  }
  if (a.pain === 0) base.dpComfort -= 1;
  const L = { ...base };
  const R = { ...base };
  const tune = (e, f) => {
    e.rateMax *= f;
    e.dpComfort -= 1;
    e.lead += 4;
  };
  if (a.side === 0) tune(L, 0.75);
  if (a.side === 1) tune(R, 0.75);
  if (a.side === 2) {
    L.rateMax *= 0.88;
    R.rateMax *= 0.88;
  }
  const fix = (e) => ({
    rateMax: Math.min(LIMITS.rateMax[1], Math.max(LIMITS.rateMax[0], Math.round(e.rateMax * 2) / 2)),
    dpComfort: Math.min(LIMITS.dpComfort[1], Math.max(LIMITS.dpComfort[0], e.dpComfort)),
    lead: Math.min(LIMITS.lead[1], Math.max(LIMITS.lead[0], e.lead)),
  });
  const before = { L: { ...state.profile.L }, R: { ...state.profile.R } };
  state.profile.L = fix(L);
  state.profile.R = fix(R);
  state.profile.questionnaire = { ...a, t: Date.now() };
  pushHistory('问卷评估', before);
  saveProfile();
  api.syncProfile();
  const p = state.profile;
  openSheet(`
    <div class="quiz-done">
      <span class="eyebrow">CHECK COMPLETE</span>
      <h2>已生成双耳参数</h2>
      <div class="fb-head">${headSVG('both')}</div>
      <div class="duo">
        <div class="L"><span class="badge L">L</span><label>左耳</label><b>${rateWord(p.L.rateMax)}</b><small>${dpWord(p.L.dpComfort)} · 提前 ${p.L.lead}s</small></div>
        <div class="R"><span class="badge R">R</span><label>右耳</label><b>${rateWord(p.R.rateMax)}</b><small>${dpWord(p.R.dpComfort)} · 提前 ${p.R.lead}s</small></div>
      </div>
      ${a.nose === 0 ? `<div class="alert warn">${ICON.info}<div><b>医生提示</b><p>经常鼻塞会影响咽鼓管通气。乘机前如果鼻塞明显，可以咨询医生是否需要用药。</p></div></div>` : ''}
      ${a.phase === 0 ? '<p class="muted">你降落时更难受，下降阶段请打开吞咽教练。</p>' : ''}
      <button class="btn primary block" data-act="close">完成</button>
    </div>`);
}

// ---------- 飞行日志 ----------
let compareMode = false;
let selected = [];

function sparkSVG(sp) {
  if (!sp || !sp.L?.length) return '';
  const all = [...sp.L, ...sp.R].map(Math.abs);
  const m = Math.max(50, ...all);
  const n = sp.L.length;
  const pts = (arr) => arr.map((v, i) => `${((i / (n - 1)) * 120).toFixed(1)},${(15 - (v / m) * 13).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 120 30" class="spark" preserveAspectRatio="none"><line x1="0" y1="15" x2="120" y2="15"/>
    <polyline points="${pts(sp.L)}" class="L"/><polyline points="${pts(sp.R)}" class="R"/></svg>`;
}

export async function renderRecords() {
  const el = $('#view-records');
  const list = await db.listSessions();
  const trips = list.filter((m) => !m.experiment);
  const withFb = trips.filter((m) => m.feedback);
  const avg = withFb.length ? withFb.reduce((s, m) => s + (m.feedback.L + m.feedback.R) / 2, 0) / withFb.length : NaN;
  const hours = trips.reduce((s, m) => s + m.metrics.duration, 0) / 3600;
  el.innerHTML = `
    <div class="page-head row"><div><span class="eyebrow">LOGBOOK</span><h2>飞行日志</h2><p>每段航程与实验的完整数据，可导出 CSV。</p></div>
      <button class="btn chip-btn ${compareMode ? 'on' : ''}" id="btnCmp">${ICON.compare}${compareMode ? '取消' : '对比'}</button></div>
    <div class="panel counters">
      <div><small>航段</small><b>${String(trips.length).padStart(3, '0')}</b></div>
      <div><small>累计时长</small><b>${hours.toFixed(1)}<i>h</i></b></div>
      <div><small>实验</small><b>${String(list.length - trips.length).padStart(3, '0')}</b></div>
      <div><small>平均不适</small><b>${fmt(avg, 1)}</b></div>
    </div>
    ${compareMode ? `<div class="caution info"><span class="cap-tag">SELECT</span><div><b>选择两条记录进行对比</b><small>已选 ${selected.length} / 2 · 适合预测开/关或左右对调实验</small></div></div>` : ''}
    <div class="strips">
      ${list.length ? list.map((m) => {
        const t = TRIP_TYPES[m.type] || TRIP_TYPES.flight;
        const d = new Date(m.start);
        return `
        <button class="strip ${m.type} ${selected.includes(m.id) ? 'sel' : ''}" data-id="${m.id}">
          <div class="s-code"><b>${t.code}</b><small>${d.getMonth() + 1}/${d.getDate()}</small></div>
          <div class="s-main"><b>${esc(m.name)}</b>
            <small>${fmtDate(m.start)} · ${fmtDur(m.metrics.duration)}${m.source === 'sim' ? ' · SIM' : ''}${m.events?.length ? ` · 打卡 ${m.events.length}` : ''}</small>
            ${sparkSVG(m.spark)}</div>
          <div class="s-side"><span class="L">L ${fmt(m.metrics.L.peak, 1)}</span><span class="R">R ${fmt(m.metrics.R.peak, 1)}</span>
            ${m.feedback ? `<span class="fbdots"><i class="lv${m.feedback.L}"></i><i class="lv${m.feedback.R}"></i></span>` : ''}</div>
        </button>`;
      }).join('') : `<div class="panel empty">${ICON.records}<b>日志还是空的</b><p>到「航程」选择一个航段出发吧。</p></div>`}
    </div>`;
  $('#btnCmp').onclick = () => {
    compareMode = !compareMode;
    selected = [];
    renderRecords();
  };
  el.querySelectorAll('.strip').forEach((b) => (b.onclick = () => {
    const id = +b.dataset.id;
    const meta = list.find((m) => m.id === id);
    if (!compareMode) return openDetail(meta);
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(-2);
    if (selected.length === 2) {
      const [a, c] = selected.map((x) => list.find((m) => m.id === x)).sort((x, y) => x.start - y.start);
      compareMode = false;
      selected = [];
      renderRecords();
      openCompare(a, c);
    } else renderRecords();
  }));
}

function metricTable(m) {
  const rows = [
    ['峰值压差', 'peak', 'hPa', 1],
    ['不适负荷', 'load', 'hPa·s', 0],
    ['耳道最快变化', 'maxRate', 'hPa/min', 0],
    ['安全泄压', 'safety', '次', 0],
  ];
  return `<table class="mt"><thead><tr><th></th><th class="L">左耳 L</th><th class="R">右耳 R</th></tr></thead><tbody>
    ${rows.map(([n, k, u, d]) => `<tr><td>${n}<small>${u}</small></td><td>${fmt(m.L[k], d)}</td><td>${fmt(m.R[k], d)}</td></tr>`).join('')}
    </tbody></table>`;
}

async function openDetail(meta) {
  const samples = await db.getSamples(meta.id);
  const t = TRIP_TYPES[meta.type] || TRIP_TYPES.flight;
  const sh = openSheet(`
    <div class="det-head"><span class="code-tag">${t.code}</span><div><h2>${esc(meta.name)}</h2>
      <small class="muted">${fmtDate(meta.start)} · ${fmtDur(meta.metrics.duration)} · ${samples.length} 点</small></div></div>
    <div class="pill-row">
      <span class="pill ${meta.predict ? 'on' : ''}">PRED ${meta.predict ? 'ON' : 'OFF'}</span>
      ${meta.swapped ? '<span class="pill on">左右对调</span>' : ''}
      <span class="pill">${meta.source === 'sim' ? 'SIM 模拟' : 'DEV 设备'}</span>
      <span class="pill">${fmt(meta.metrics.pMin, 1)}–${fmt(meta.metrics.pMax, 1)} hPa</span>
    </div>
    <div class="panel-title"><span>FLIGHT PROFILE · 航段剖面</span></div>
    <canvas class="chart" id="dA"></canvas>
    <div class="panel-title"><span>ΔP TRACE · 耳塞内外压差</span><span class="legend"><span><i class="l"></i>L</span><span><i class="r"></i>R</span></span></div>
    <canvas class="chart small" id="dB"></canvas>
    ${metricTable(meta.metrics)}
    ${meta.events?.length ? `<div class="panel-title"><span>EVENT LOG · 打卡</span></div><div class="evlog-in">${eventListHTML(meta.events)}</div>` : ''}
    <div class="params"><span class="L">L 速度 ${meta.params.L.rateMax} · 耐受 ±${meta.params.L.dpComfort} · 提前 ${meta.params.L.lead}s</span>
      <span class="R">R 速度 ${meta.params.R.rateMax} · 耐受 ±${meta.params.R.dpComfort} · 提前 ${meta.params.R.lead}s</span></div>
    ${meta.feedback ? `<p>落地反馈：左耳 <b>${FB[meta.feedback.L]}</b> · 右耳 <b>${FB[meta.feedback.R]}</b></p>` : ''}
    ${meta.note ? `<p class="muted">备注：${esc(meta.note)}</p>` : ''}
    <div class="row2"><button class="btn ghost" id="dDel">${ICON.trash}删除</button><button class="btn primary" id="dCsv">${ICON.download}导出 CSV</button></div>`);
  requestAnimationFrame(() => {
    if (!samples.length) return;
    drawTripProfile($('#dA', sh), { samples, events: meta.events, qnh: state.settings.qnh, phaseOf: phaseKeyOf(meta.type) });
    const t0 = samples[0].t;
    const X = (s) => (s.t - t0) / 1000;
    const c = Math.min(meta.params.L.dpComfort, meta.params.R.dpComfort);
    drawChart($('#dB', sh), {
      xMin: 0, xMax: X(samples[samples.length - 1]), xFmt: fmtDur, zero: true, minSpan: c * 2 + 1,
      band: { y0: -c, y1: c, color: 'rgba(18,184,134,0.12)' },
      markers: (meta.markers || []).map((m) => ({ x: m.t / 1000, label: m.label })),
      series: [
        { data: samples.map((s) => [X(s), s.dpL / 100]), color: '#3fa0ff', width: 1.8 },
        { data: samples.map((s) => [X(s), s.dpR / 100]), color: '#ff7a6b', width: 1.8 },
      ],
    });
  });
  $('#dCsv', sh).onclick = () => exportCSV(meta, samples);
  $('#dDel', sh).onclick = async () => {
    if (!confirm('删除这条记录？')) return;
    await db.deleteSession(meta.id);
    closeSheet();
    renderRecords();
  };
}

async function openCompare(a, b) {
  const [sa, sb] = await Promise.all([db.getSamples(a.id), db.getSamples(b.id)]);
  const n = Math.max(3, Math.floor(Math.min(a.metrics.duration, b.metrics.duration)));
  const g = (s, k) => resample(s, k, 1000, n);
  const aL = g(sa, 'dpL'), aR = g(sa, 'dpR'), bL = g(sb, 'dpL'), bR = g(sb, 'dpR');
  const same = (corr(aL, bL) + corr(aR, bR)) / 2;
  const swapTest = a.swapped !== b.swapped;
  const predTest = a.predict !== b.predict;
  let verdict = '';
  const maxPeak = Math.max(a.metrics.L.peak, a.metrics.R.peak, b.metrics.L.peak, b.metrics.R.peak);
  if (n < 20 || maxPeak < 0.5) {
    verdict = `<div class="alert warn">${ICON.info}<div><b>数据不足，暂不下结论</b><p>两条记录需覆盖完整的减压/回压过程（至少 20 秒且有明显压差变化）。</p></div></div>`;
  } else if (swapTest) {
    const dA = aL.map((v, i) => v - aR[i]);
    const dB = bL.map((v, i) => v - bR[i]);
    const rDiff = corr(dA, dB);
    const rms = Math.sqrt(dA.filter(Number.isFinite).reduce((s, v) => s + v * v, 0) / Math.max(1, dA.length)) / 100;
    verdict = rms < 0.15
      ? `<div class="alert warn">${ICON.info}<div><b>左右差异太小，无法判断</b><p>A 中左右压差的均方根差仅 ${fmt(rms, 2)} hPa。请把两侧参数设得差异更大后再测。</p></div></div>`
      : rDiff < -0.5
        ? `<div class="alert ok">${ICON.shield}<div><b>曲线随参数对调而交换</b><p>"左减右"差值曲线相关系数 r = ${fmt(rDiff, 2)}（接近 −1 表示完全反号），左右差异化控制确实体现在两侧气压上。</p></div></div>`
        : `<div class="alert warn">${ICON.info}<div><b>未观察到明显交换</b><p>"左减右"差值曲线相关系数 r = ${fmt(rDiff, 2)}，交换成立时应接近 −1。请检查气路一致性与参数下发。</p></div></div>`;
  }
  if (predTest && verdict === '') {
    const [off, onM] = a.predict ? [b, a] : [a, b];
    const pc = (k, f) => {
      const x = off.metrics[k][f];
      const y = onM.metrics[k][f];
      return x ? Math.round(((x - y) / x) * 100) : 0;
    };
    verdict += `<div class="alert ok">${ICON.sparkle}<div><b>预测开启 vs 关闭</b>
      <p>耳道最快变化速率：左降 ${pc('L', 'maxRate')}% · 右降 ${pc('R', 'maxRate')}%；峰值压差：左 ${pc('L', 'peak')}% · 右 ${pc('R', 'peak')}%（正数代表开启预测后更低）。</p></div></div>`;
  }
  const sh = openSheet(`
    <span class="eyebrow">ANALYSIS</span>
    <h2>对比分析</h2>
    <div class="legend wide"><span><i class="l"></i>A 左</span><span><i class="r"></i>A 右</span><span><i class="l dash"></i>B 左</span><span><i class="r dash"></i>B 右</span></div>
    <p class="muted small">A：${esc(a.name)} · ${fmtDate(a.start)}<br>B：${esc(b.name)} · ${fmtDate(b.start)}</p>
    <canvas class="chart" id="cA"></canvas>
    ${verdict}
    <table class="mt"><thead><tr><th></th><th class="L">A 左</th><th class="R">A 右</th><th class="L">B 左</th><th class="R">B 右</th></tr></thead><tbody>
      <tr><td>峰值压差</td><td>${fmt(a.metrics.L.peak, 1)}</td><td>${fmt(a.metrics.R.peak, 1)}</td><td>${fmt(b.metrics.L.peak, 1)}</td><td>${fmt(b.metrics.R.peak, 1)}</td></tr>
      <tr><td>最快变化</td><td>${fmt(a.metrics.L.maxRate, 0)}</td><td>${fmt(a.metrics.R.maxRate, 0)}</td><td>${fmt(b.metrics.L.maxRate, 0)}</td><td>${fmt(b.metrics.R.maxRate, 0)}</td></tr>
      <tr><td>不适负荷</td><td>${fmt(a.metrics.L.load, 0)}</td><td>${fmt(a.metrics.R.load, 0)}</td><td>${fmt(b.metrics.L.load, 0)}</td><td>${fmt(b.metrics.R.load, 0)}</td></tr>
    </tbody></table>
    <p class="muted small">同侧曲线相关 r = ${fmt(same, 2)}（按 1 秒对齐，共 ${n} 点）</p>`);
  requestAnimationFrame(() => {
    const mk = (arr) => arr.map((v, i) => [i, v / 100]);
    drawChart($('#cA', sh), {
      xMin: 0, xMax: n - 1, zero: true, xFmt: fmtDur,
      series: [
        { data: mk(aL), color: '#3fa0ff', width: 2 },
        { data: mk(aR), color: '#ff7a6b', width: 2 },
        { data: mk(bL), color: '#3fa0ff', width: 1.6, dash: [5, 4] },
        { data: mk(bR), color: '#ff7a6b', width: 1.6, dash: [5, 4] },
      ],
    });
  });
}

function exportCSV(meta, samples) {
  const t0 = samples[0]?.t || 0;
  const head = 't_ms,p_amb_pa,p_L_pa,p_R_pa,dp_L_pa,dp_R_pa,duty_L,duty_R,pred_slope_pa_s,pred_on,swapped,safety_L,safety_R,marker';
  const rows = samples.map((s) => [
    s.t - t0, s.pAmb.toFixed(2), (s.pAmb + s.dpL).toFixed(2), (s.pAmb + s.dpR).toFixed(2), s.dpL.toFixed(1), s.dpR.toFixed(1),
    s.dutyL, s.dutyR, s.predSlope.toFixed(2), s.flags & 16 ? 1 : 0, s.flags & 32 ? 1 : 0, s.flags & 4 ? 1 : 0, s.flags & 8 ? 1 : 0,
    s.marker ? `"${s.marker}"` : '',
  ].join(','));
  const metaLines = [
    `# ${meta.name}`, `# start=${new Date(meta.start).toISOString()} source=${meta.source}`,
    `# params_L=${JSON.stringify(meta.params.L)} params_R=${JSON.stringify(meta.params.R)}`,
    ...(meta.events || []).map((e) => `# event t_ms=${e.t} side=${e.side} type=${e.type} phase=${e.phase}`),
  ];
  const blob = new Blob(['\ufeff' + [...metaLines, head, ...rows].join('\n')], { type: 'text/csv' });
  const d = new Date(meta.start);
  const name = `aeroear_${meta.id}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`;
  const file = new File([blob], name, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- 设置 ----------
export function openSettings() {
  const st = state.settings;
  const isSim = st.source === 'sim';
  const speeds = [1, 5, 10, 20, 60, 200];
  const sh = openSheet(`
    <span class="eyebrow">SYSTEM</span>
    <h2>设置</h2>
    <div class="set-group">
      <h4>数据来源 SOURCE</h4>
      <div class="seg wide" id="srcSeg"><button data-s="sim" class="${isSim ? 'on' : ''}">模拟演示</button><button data-s="ble" class="${!isSim ? 'on' : ''}">蓝牙设备</button></div>
      ${isSim ? `
        <label class="field"><span>模拟场景</span><select id="simSc">${Object.entries(api.scenarios).map(([k, s]) => `<option value="${k}" ${k === st.simScenario ? 'selected' : ''}>${s.name} · ${s.desc}</option>`).join('')}</select></label>
        <label class="field"><span>时间倍速</span><select id="simSp">${speeds.map((v) => `<option value="${v}" ${v === st.simSpeed ? 'selected' : ''}>${v}×</option>`).join('')}</select></label>
        <button class="btn ghost block" id="simReset">从头播放</button>` : `
        <div class="dev-row"><span class="ti">${ICON.bt}</span><div><b>${state.connected ? esc(state.deviceName) : '未连接'}</b>
          <small>${bleSupported() ? (state.connected ? '数据接收中' : '请打开设备电源，并允许蓝牙权限') : '此浏览器不支持 Web Bluetooth，请使用安卓 Chrome'}</small></div>
          <button class="btn ${state.connected ? 'ghost' : 'primary'}" id="bleBtn" ${bleSupported() ? '' : 'disabled'}>${state.connected ? '断开' : '连接'}</button></div>`}
    </div>
    <div class="set-group">
      <h4>高度校准 QNH</h4>
      <label class="field"><span>海平面气压 QNH (hPa)</span><input type="number" step="0.1" id="qnh" value="${st.qnh}"></label>
      <div class="inline"><input type="number" id="knownAlt" placeholder="已知当前海拔 (m)"><button class="btn ghost" id="calAlt">校准</button></div>
      <small class="muted">气压换算的高度会受天气影响。机舱内显示的是座舱等效高度，不是飞机高度。</small>
    </div>
    <div class="set-group">
      <h4>提醒与模式</h4>
      <div class="toggle-row"><div><b>吞咽提醒</b><small>下降时轻震动提示</small></div><button class="switch ${st.prompts ? 'on' : ''}" data-t="prompts"><i></i></button></div>
      <div class="toggle-row"><div><b>实验模式</b><small>A/B 对比、左右对调、标记与原始数据导出</small></div><button class="switch ${st.experiment ? 'on' : ''}" data-t="experiment"><i></i></button></div>
    </div>
    <div class="set-group">
      <h4>安全保护 PROTECTION</h4>
      <div class="toggle-row"><div><b>压差上限 ${st.safetyLimit} hPa</b><small>任一侧超过即两阀全开，固件最高优先级，不可关闭</small></div>
        ${st.experiment ? '<button class="btn ghost" id="limBtn">调整</button>' : `<span class="lock">${ICON.shield}</span>`}</div>
      <button class="btn ghost block" id="safeBtn">${ICON.shield}健康与安全须知</button>
      <button class="btn ghost block" id="briefBtn">${ICON.info}重看安全简报</button>
    </div>
    <div class="set-group">
      ${api.install ? `<button class="btn primary block" id="instBtn">${ICON.download}安装到手机桌面</button>` : ''}
      <button class="btn ghost block danger-text" id="clrBtn">${ICON.trash}清除所有记录</button>
      <p class="muted small center">AEROEAR v1.1 · 数据仅保存在本机</p>
    </div>`);

  sh.querySelectorAll('#srcSeg button').forEach((b) => (b.onclick = () => {
    api.setSource(b.dataset.s);
    openSettings();
  }));
  $('#simSc', sh)?.addEventListener('change', (e) => {
    api.setSimScenario(e.target.value);
    openSettings();
  });
  $('#simSp', sh)?.addEventListener('change', (e) => api.setSimSpeed(+e.target.value));
  $('#simReset', sh)?.addEventListener('click', () => {
    api.resetSim();
    toast('已从头播放');
  });
  $('#bleBtn', sh)?.addEventListener('click', async () => {
    if (state.connected) api.disconnectBle();
    else await api.connectBle();
    openSettings();
  });
  $('#qnh', sh).onchange = (e) => {
    const v = +e.target.value;
    if (v > 900 && v < 1100) {
      st.qnh = v;
      saveSettings();
    } else toast('请输入 900–1100 之间的数值');
  };
  $('#calAlt', sh).onclick = () => {
    const h = parseFloat($('#knownAlt', sh).value);
    if (!state.last || !Number.isFinite(h)) return toast('请先输入海拔，并确保有气压数据');
    st.qnh = Math.round(qnhFromAlt(state.last.pAmb, h) * 100) / 100;
    saveSettings();
    $('#qnh', sh).value = st.qnh;
    toast(`已校准 QNH = ${st.qnh} hPa`);
  };
  sh.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
    st[b.dataset.t] = !st[b.dataset.t];
    saveSettings();
    b.classList.toggle('on', st[b.dataset.t]);
    if (b.dataset.t === 'experiment') openSettings();
  }));
  $('#limBtn', sh)?.addEventListener('click', () => {
    const v = parseFloat(prompt('压差上限 (hPa)，范围 5–20。仅限实验台架使用，真人佩戴请保持医学顾问确认的数值。', st.safetyLimit));
    if (!Number.isFinite(v) || v < 5 || v > 20) return toast('未修改');
    if (!confirm(`确认将压差上限改为 ${v} hPa？`)) return;
    st.safetyLimit = v;
    saveSettings();
    openSettings();
  });
  $('#safeBtn', sh).onclick = openSafety;
  $('#briefBtn', sh).onclick = openOnboarding;
  $('#instBtn', sh)?.addEventListener('click', async () => {
    api.install.prompt();
    await api.install.userChoice;
    api.install = null;
    closeSheet();
  });
  $('#clrBtn', sh).onclick = async () => {
    if (!confirm('清除所有航程与实验记录？此操作不可恢复。')) return;
    await db.clearAll();
    renderRecords();
    toast('已清除');
  };
}

function openSafety() {
  openSheet(`
    <span class="eyebrow">MEDICAL</span>
    <h2>健康与安全须知</h2>
    <div class="alert risk">${ICON.shield}<div><b>立即停止使用并就医</b><p>耳痛持续或加重、听力下降、耳鸣、眩晕、耳内流液或出血。</p></div></div>
    ${earDiagramSVG()}
    <h4>不建议使用的情况</h4>
    <ul class="list-check"><li>鼓膜穿孔，或做过鼓膜置管</li><li>中耳炎、外耳道炎急性期</li><li>近期做过耳部或鼻窦手术</li><li>严重感冒、鼻窦炎、明显鼻塞</li><li>潜水等水下活动</li></ul>
    <h4>它是怎么工作的</h4>
    <p class="muted">AeroEar 测量的是耳塞后方的<b>外耳道气压</b>，通过控制换气节奏，让外耳道气压以你的耳朵能跟上的速度变化。它测不到中耳气压，也不能替代咽鼓管的作用。</p>
    <h4>推荐做法</h4>
    <ul class="list-check"><li>下降阶段多吞咽、打哈欠、嚼口香糖</li><li>本设备不适用于婴幼儿；婴幼儿可在起降时喂奶或喂水</li><li>不要在鼻塞时用力捏鼻鼓气</li></ul>
    <button class="btn primary block" data-act="close">我知道了</button>`);
}
