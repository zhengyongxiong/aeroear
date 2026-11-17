# AeroEar 智能耳压 · PWA

基于环境气压趋势预测、左右耳分别调节的智能耳压适应系统的手机应用。
纯前端 PWA，零依赖、无需构建，支持安卓安装到桌面、离线使用、Web Bluetooth 连接设备。

## 角色讨论结论

| 角色 | 提出的问题 | 落地到应用里的做法 |
|---|---|---|
| **UI 设计师** | 机舱光线暗，手机常单手操作；左右耳容易看混 | 深色玻璃质感界面，核心数字 58pt 细体；**左蓝右红**（沿用听力图惯例），并始终带 L/R 字样，照顾色弱用户；底部悬浮导航；震动代替声音提示 |
| **前端工程师** | 飞机上没网、设备可能还没做好、要长期记录 | Service Worker 离线缓存；内置**设备模拟器**（与固件控制逻辑一致）；IndexedDB 中元数据和原始数据分开存；Canvas 自绘图表，不依赖第三方库；10 分钟实时环形缓冲 |
| **医生** | 测的是耳道气压，不是中耳气压；有禁忌人群；不能宣称治疗 | 首次使用必须阅读禁忌说明并勾选确认；文案统一用"耳塞内外压差"；只提示吞咽/打哈欠，**不推荐捏鼻鼓气**；用户反馈"疼痛"时弹出就医提示；安全泄压上限不可关闭 |
| **乘客** | 不懂参数，只想登机点一下；想知道什么时候会难受 | 一键"飞行"行程，自动识别 地面/爬升/巡航/下降；"30 秒后预计"与趋势预测虚线；下降时震动提醒吞咽；问卷 1 分钟生成左右耳参数；行程结束只需选 4 档感受 |

## 功能（v1.3 活泼插画风）

- **画风**：奶油底色、深紫粗描边、硬阴影贴纸卡片；按钮按下会"啪"地陷下去；样式在 `css/toon.css`（覆盖 `app.css` 的视觉层，改配色只需改文件顶部的变量）
- **舷窗首页**：卡通天空（笑脸太阳、描边云朵、绿色山丘），带眼睛的小飞机拖着白色尾迹，紫色圆点是预测走向。点舷窗切换 1 / 5 / 15 分钟，下拉遮光帘进入夜航模式（双击拉手收回）
- **水球宝宝**：左右耳各一颗，液面 = 耳塞内外压差；舒适时微笑，注意时嘴巴变圆并冒汗，不适时晕乎乎并抖动；阀门打开时冒气泡
- **小云提示**：吉祥物小云会随状态变表情（开心 / 担心 / 晕），待机时说"一切舒适"
- **彩纸庆祝**：出发、耳朵通了、保存日志、打卡时撒彩纸（`js/fx.js`）
- **航程**：翻牌出发屏 → 登机牌 → 滑动出发；落地后点头像上的耳朵反馈不适程度
- **双耳 / 日志 / 手势**：同前，左右滑动切换页面

## 本地运行

```bash
cd app
python3 -m http.server 8080
# 电脑浏览器打开 http://localhost:8080
```

首次进入默认是**模拟演示**，可以在 设置 → 数据来源 切换到蓝牙设备。

## 安装到安卓手机

Web Bluetooth 与 PWA 安装都需要 **HTTPS**（或 localhost）。任选一种：

1. **部署到 HTTPS 静态托管（推荐）**：把 `app/` 目录上传到 GitHub Pages、Netlify、Vercel 或 Cloudflare Pages。手机 Chrome 打开网址 → 菜单 →「安装应用 / 添加到主屏幕」，或在 App 的 设置 中点「安装到手机桌面」。
2. **USB 调试（开发时）**：手机开启 USB 调试并连接电脑，在电脑 Chrome 打开 `chrome://inspect/#devices` → Port forwarding 添加 `8080 → localhost:8080`。手机 Chrome 访问 `http://localhost:8080` 即可安装和使用蓝牙。
3. **需要 APK 上架**：用 [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) 把已部署的 PWA 打包为 TWA 安装包。

> iOS Safari 不支持 Web Bluetooth，iPhone 上只能使用模拟和记录功能。

## BLE 协议（固件需按此实现）

Service `8b3f0001-6c2e-4f1a-9d7e-2a5b9c4e1d00`，设备广播名建议以 `AeroEar` 开头。

| Characteristic | UUID 前缀 | 属性 | 内容 |
|---|---|---|---|
| Telemetry | `8b3f0002` | Notify | 20 字节数据包，10 Hz |
| Control | `8b3f0003` | Write | `[op, ...args]` |
| Profile | `8b3f0004` | Write | 14 字节左右耳参数 |
| Info | `8b3f0005` | Read | `[电量 u8][固件版本 UTF-8]` |

UUID 后半段都是 `-6c2e-4f1a-9d7e-2a5b9c4e1d00`。

**Telemetry（小端）**：`seq u16 | t_ms u32 | p_amb u32 (0.01 Pa) | dp_L i16 (0.1 Pa) | dp_R i16 (0.1 Pa) | duty_L u8 | duty_R u8 | pred_slope i16 (0.1 Pa/s) | state u8 | flags u8`
其中 dp = 耳塞后腔气压 − 环境气压。flags 各位：bit0 左阀开、bit1 右阀开、bit2 左安全泄压、bit3 右安全泄压、bit4 预测开、bit5 左右对调。

**Control**：`0x01 模式` · `0x02 预测 0/1` · `0x03 对调 0/1` · `0x04 标记码` · `0x05 手动 dutyL dutyR` · `0x06 全开泄压`

**Profile（小端）**：`version u16`，随后左、右各一组 `rateMax u16 (0.01 hPa/min) | dpComfort u16 (0.01 hPa) | lead u16 (0.1 s)`

控制逻辑的参考实现见 `js/sim.js` 中的 `EarController`，固件可以直接移植。

## 目录

```
app/
├── index.html / manifest.webmanifest / sw.js
├── css/app.css
├── js/
│   ├── app.js      数据源、实时页、行程记录、参数学习
│   ├── views.js    行程 / 我的耳朵 / 记录 / 设置 / 引导 / 问卷 / 对比
│   ├── state.js    共享状态、指标计算、工具函数
│   ├── sim.js      设备模拟器 + EarController（固件参考）
│   ├── ble.js      Web Bluetooth 与协议编解码
│   ├── chart.js    Canvas 图表
│   ├── store.js    IndexedDB
│   └── icons.js
├── icons/          图标（tools/make_icons.py 生成 PNG）
└── tools/make_icons.py
```

## 待定事项

- 安全压差上限目前为占位值 **12 hPa**，需要医学顾问确认后，同时写入固件和 `js/state.js` 的 `DEFAULT_SETTINGS.safetyLimit`
- 问卷到参数的映射（`views.js` 中的 `finishQuiz`）是初版经验值，需要用真实数据校准
- 修改任何前端文件后，要把 `sw.js` 里的 `VERSION` 加一，手机才会更新缓存
