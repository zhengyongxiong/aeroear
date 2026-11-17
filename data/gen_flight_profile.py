"""生成一次完整客机飞行（窄体机，约 2.2 小时）的座舱气压模拟数据。

依据（公开资料，数值为典型值）：
- 外界大气：国际标准大气 ISA（对流层 6.5 K/km，11 km 以上等温 216.65 K）
- 座舱压力由增压系统按调度控制，不等于外界大气：
  * 起飞前预增压：座舱当量海拔比机场低约 150 ft，使起飞时压力不出现下掉
  * 爬升：座舱爬升率约 300–400 ft/min（受限于约 500 ft/min）
  * 巡航：座舱当量海拔约 7000–7500 ft（法规上限 8000 ft）
  * 下降：座舱下降率约 300–450 ft/min，下降末段略快，落地前比目的地机场低约 150 ft
  * 落地后泄压：座舱压力回到机场环境压力（约 10 秒）
- 座舱内的压力扰动：空调系统循环（AR(1)，σ≈0.08 hPa，τ≈8 s）、关舱门压力脉冲、起落架动作等
- 传感器噪声：σ≈0.015 hPa（BMP390 高分辨率模式量级）

用法：python3 data/gen_flight_profile.py
输出：data/flight_A320_sim.csv（1 Hz）、app/js/flightdata.js（2 s 间隔，供应用回放）
"""
import csv
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
random.seed(20261116)

FT = 0.3048
T_END = 8040
# 时间轴（秒）
T_DOOR_CLOSE, T_ROLL, T_LIFT, T_TOC = 240, 600, 660, 2080
T_STEP0, T_STEP1, T_TOD, T_TD, T_ROLLOUT_END = 3900, 4080, 6000, 7440, 7560
T_DOOR_OPEN = 7900

ORIGIN_ELEV, DEST_ELEV = 4.0, 35.0
QNH_O, QNH_D = 1016.0, 1009.0
PRE = -150 * FT  # 预增压：低于机场 150 ft


def isa_p(h, qnh):
    if h <= 11000:
        return qnh * (1 - 0.0065 * h / 288.15) ** 5.255
    p11 = qnh * (1 - 0.0065 * 11000 / 288.15) ** 5.255
    return p11 * math.exp(-9.80665 * (h - 11000) / (287.05 * 216.65))


def isa_t(h):
    return 15 - 0.0065 * h if h <= 11000 else -56.5


def interp(pts, t):
    if t <= pts[0][0]:
        return pts[0][1]
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * (t - t0) / (t1 - t0)
    return pts[-1][1]


# 飞机高度关键点（m）：爬升 3000 → 1800 → 1000 fpm，FL370 → 阶梯爬升 FL390；下降含两次平飞
AC = [
    (0, ORIGIN_ELEV), (T_LIFT, ORIGIN_ELEV), (T_LIFT + 200, 3048), (T_LIFT + 700, 7620), (T_TOC, 11277),
    (T_STEP0, 11277), (T_STEP1, 11887), (T_TOD, 11887),
    (6600, 6100), (6660, 6100), (6960, 3050), (7020, 3050), (7380, 450), (T_TD, DEST_ELEV), (T_END, DEST_ELEV),
]


def smooth(series, w):
    out, n = [], len(series)
    for i in range(n):
        a, b = max(0, i - w), min(n, i + w + 1)
        out.append(sum(series[a:b]) / (b - a))
    return out


ac_alt = smooth([interp(AC, t) for t in range(T_END + 1)], 8)
ac_alt = [ORIGIN_ELEV if t <= T_LIFT else DEST_ELEV if t >= T_TD else max(v, 0) for t, v in enumerate(ac_alt)]


def cab_target(t, h):
    """座舱目标当量海拔（m，相对海平面）"""
    if t < T_ROLL:
        return ORIGIN_ELEV
    if t >= T_TD:
        return DEST_ELEV
    if t >= 7380:
        return DEST_ELEV + PRE
    pre = PRE + (ORIGIN_ELEV if t < T_TOD else DEST_ELEV)
    return pre + (2255 - pre) * (max(h, 0) / 11887) ** (0.7 if t < T_TOD else 0.9)


cab = [ORIGIN_ELEV]
for t in range(1, T_END + 1):
    tgt = cab_target(t, ac_alt[t])
    up_max = 125 / 60 if t < T_TD else 300 / 60
    dn_max = 165 / 60
    if t < T_TD:
        step = max(-dn_max, min(up_max, (tgt - cab[-1]) / (25 if t < T_TOD else 12)))
    else:  # 落地后泄压
        step = max(-dn_max, min(up_max, (tgt - cab[-1]) / 4))
    cab.append(cab[-1] + step)


def qnh(t):
    if t < T_TOC:
        return QNH_O
    if t > T_TOD:
        return QNH_D
    return QNH_O + (QNH_D - QNH_O) * (t - T_TOC) / (T_TOD - T_TOC)


# 座舱压力（干净）+ 扰动
clean = [isa_p(cab[t], qnh(t)) for t in range(T_END + 1)]
phi = math.exp(-1 / 8)
sig = 0.08
x = 0.0
dist = []
for t in range(T_END + 1):
    x = phi * x + sig * math.sqrt(1 - phi * phi) * random.gauss(0, 1)
    in_air = T_ROLL + 20 <= t <= T_TD
    dist.append(x if in_air else 0.0)


def pulse(t, t0, amp, tau):
    return amp * math.exp(-(t - t0) / tau) if t >= t0 else 0.0


EVENTS = [(T_DOOR_CLOSE, +1.6, 1.5), (T_ROLL + 40, -0.20, 2.0), (T_LIFT + 45, -0.30, 2.5), (7300, -0.22, 2.5), (T_DOOR_OPEN, -1.2, 1.5)]
meas = []
for t in range(T_END + 1):
    v = clean[t] + dist[t] + sum(pulse(t, e[0], e[1], e[2]) for e in EVENTS)
    meas.append(v + random.gauss(0, 0.015))


def phase(t):
    if t < T_DOOR_CLOSE: return "GATE"
    if t < T_ROLL: return "TAXI_OUT"
    if t < T_LIFT: return "TAKEOFF_ROLL"
    if t < T_TOC: return "CLIMB"
    if t < T_TOD: return "CRUISE"
    if t < 7380: return "DESCENT"
    if t < T_TD: return "APPROACH"
    if t < T_ROLLOUT_END: return "ROLLOUT"
    return "TAXI_IN"


clean_s = smooth(clean, 15)
rows = []
for t in range(T_END + 1):
    a, b = max(0, t - 15), min(T_END, t + 15)
    rate = (clean_s[b] - clean_s[a]) / (b - a) * 60  # hPa/min
    cab_ft = cab[t] / FT
    cab_rate_fpm = (cab[b] - cab[a]) / (b - a) * 60 / FT
    h = ac_alt[t]
    vs = (ac_alt[b] - ac_alt[a]) / (b - a) * 60 / FT
    cab_t = 23.0 - 1.0 * min(1, t / 900) + random.gauss(0, 0.04)
    rows.append([
        t, phase(t), round(h, 1), round(h / FT), round(vs), round(isa_p(h, qnh(t)), 2), round(isa_t(h), 1),
        round(cab[t], 1), round(cab_ft), round(meas[t], 3), round(clean[t], 3), round(rate, 2), round(cab_rate_fpm), round(cab_t, 2),
    ])

head = ["t_s", "phase", "ac_alt_m", "ac_alt_ft", "ac_vs_fpm", "outside_p_hpa", "outside_T_C", "cabin_alt_m", "cabin_alt_ft",
        "cabin_p_meas_hpa", "cabin_p_clean_hpa", "cabin_rate_hpa_min", "cabin_rate_fpm", "cabin_T_C"]
(ROOT / "data").mkdir(exist_ok=True)
with open(ROOT / "data" / "flight_A320_sim.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(head)
    w.writerows(rows)

# 应用回放用：2 s 间隔、Pa、含扰动但不含传感器噪声（应用模拟器会自己加传感器噪声）
STEP = 2
# 基础曲线（调度 + 舱门/起落架脉冲）与空调扰动分开存放：高倍速播放时扰动不具物理意义，应用只在接近实时速度时叠加
vals = [round((clean[t] + sum(pulse(t, e[0], e[1], e[2]) for e in EVENTS)) * 100) for t in range(0, T_END + 1, STEP)]
dvals = [round(dist[t] * 100) for t in range(0, T_END + 1, STEP)]
js = (
    "// 由 data/gen_flight_profile.py 生成：窄体客机全程座舱气压（Pa），2 s 间隔\n"
    "// FLIGHT_PA：调度曲线 + 舱门/起落架脉冲；FLIGHT_DIST：空调扰动（仅接近实时速度时叠加）\n"
    "export const FLIGHT_STEP = %d;\nexport const FLIGHT_PA = [%s];\nexport const FLIGHT_DIST = [%s];\n" % (STEP, ",".join(map(str, vals)), ",".join(map(str, dvals)))
)
(ROOT / "app" / "js" / "flightdata.js").write_text(js)

# 摘要
def seg(t0, t1):
    seg_rows = rows[t0:t1]
    rates = [r[11] for r in seg_rows]
    fpm = [r[12] for r in seg_rows]
    return min(rates), max(rates), min(fpm), max(fpm)

print("rows", len(rows), "js points", len(vals))
print("cabin alt at cruise start/end (ft):", rows[T_TOC][8], rows[T_TOD][8])
print("landing: cabin alt %.0f m (field %.0f, preload target %.0f); cabin-ambient %.1f hPa" % (cab[T_TD - 1], DEST_ELEV, DEST_ELEV + PRE, clean[T_TD - 1] - isa_p(DEST_ELEV, QNH_D)))
print("cabin P: gate %.1f  cruise %.1f  landing %.1f hPa" % (meas[0], clean[T_TOC + 600], clean[T_TD - 1]))
for name, a, b in (("CLIMB", T_LIFT + 60, T_TOC), ("STEP", T_STEP0, T_STEP1 + 120), ("DESCENT", T_TOD + 60, T_TD)):
    lo, hi, flo, fhi = seg(a, b)
    print("%-8s rate hPa/min [%.1f, %.1f]  cabin fpm [%d, %d]" % (name, lo, hi, flo, fhi))
print("total cabin dP climb %.1f hPa, descent %.1f hPa" % (clean[0] - clean[T_TOC], clean[T_TD - 1] - clean[T_TOD]))
