# dsh-calculator

A DeepSeek Harness (DSH) web plugin that shows your **DeepSeek API spend** and
**account balance** in a top-right floating card of the DSH web GUI
(collapsible to a pill).

- **当前会话费用** — the cost of the session you are looking at (per model)
- **当天全部会话累计** — today's total spend across all sessions (per model,
  **in your local timezone**; resets at local midnight)
- **账户余额** — live balance from the DeepSeek API (`GET /user/balance`)
- **第三方模型不计费** — only `deepseek-official` routes are billed; any other
  provider/model is listed as unbilled
- **峰谷计价** — after 2026-08-17 the plugin automatically prices events by the
  Beijing peak/off-peak schedule (peak 09:00–12:00 & 14:00–18:00, off-peak =
  half price); before that date it uses the current flat rates
- **中英文界面** — the panel follows your browser language (`zh` / `en`)

---

## 安装

DSH is a Cordis application. The plugin has a host half (event accounting +
balance fetching) and a browser half (top-right overlay card). Install it into
the `web` profile:

### 一条命令在线安装（推荐，无需克隆仓库）

直接在你的机器上执行（脚本会从 GitHub 下载插件文件并完成安装）：

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/bobcat848/dsh-calculator/main/install.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/bobcat848/dsh-calculator/main/install.ps1 | iex
```

### 本地克隆安装

或者克隆仓库后运行脚本（安装脚本会自动识别本地模式，从仓库内复制文件）：

```bash
git clone https://github.com/bobcat848/dsh-calculator.git
cd dsh-calculator

# macOS / Linux
bash install.sh

# Windows PowerShell
.\install.ps1
```

两种方式等价：都会把插件装进
`~/.dsh/profiles/node_modules/dsh-calculator` 并在
`~/.dsh/profiles/web/cordis.patch.yml` 追加 loader 行（幂等：重复执行安全，
已有行不会重复添加）。

### 手动安装

```bash
# 1. copy the package into the profile's hoisted node_modules
mkdir -p ~/.dsh/profiles/node_modules/dsh-calculator
cp -r lib package.json ~/.dsh/profiles/node_modules/dsh-calculator/

# 2. append the loader row to the web profile patch (once)
#    edit ~/.dsh/profiles/web/cordis.patch.yml and add:
#    - insert:
#        - id: dsh-calculator
#          name: 'dsh-calculator'
#          config: {}
```

### 重启生效

Plugins are discovered at boot, so **restart DSH web** after installing
(`cordis.patch.yml` 改动也会被 DSH 的用户层 HMR 热更新，通常无需重启):

```bash
dsh web --port 3080
```

Open (or refresh) `http://127.0.0.1:3080`, and you should see the
**DeepSeek API 费用** card in the top-right corner; click **×** to collapse it
into a pill, click the pill to expand it again.

> **v1.2.0 适配说明**：DSH `0.1.0-rc.6` 的布局不再提供 `aside` 插槽（右侧栏），
> 浏览器半改为注入框架级 `shell.overlay` 插槽（右上角浮层卡片），并移除了
> 不存在的 `ctx.layout.closeAside()`。host 半（记账 + 余额端点
> `/dsh-calculator`）保持不变。

---

## 配置

The plugin needs no configuration beyond your DeepSeek API key, which DSH
already stores through its credentials service (the Models page writes it to
`~/.dsh/.credentials.yaml` as `DEEPSEEK_API_KEY`, or you can export it in the
launching environment). The balance feature reads that same credential.

If the key is missing, the balance card shows a friendly error and the cost
panel keeps working.

## 计价口径

Rates are the official DeepSeek prices (CNY per 1M tokens):

| 模型 | 缓存命中输入 | 缓存未命中输入 | 输出 |
|---|---|---|---|
| deepseek-v4-flash（当前价） | ¥0.02 | ¥1.0 | ¥2.0 |
| deepseek-v4-pro（当前价） | ¥0.025 | ¥3.0 | ¥6.0 |
| 2026-08-17 起（峰谷） | 高峰半价 | 高峰价 | 高峰价 |

- 输出 token 包含推理 token，与普通输出同价
- 费用为估算值，与官方账单可能存在差异（缓存命中 token 量大时尤其明显）

## 数据来源

- 费用：host 半订阅 DSH 会话事件（`assistant/message` 的 `usage` +
  `message.source`），按 `(provider, model)` 记账；fork 子会话的拷贝事件按
  `message.id` 全局去重，避免重复计费
- 余额：`GET https://api.deepseek.com/user/balance`（30 秒缓存）

## 已知问题与兼容性

### 层叠上下文（z-index）遮挡 — v1.2.2 修复

**现象**：费用卡片标题栏的 × 关闭按钮被右侧文件面板的搜索框遮住，不可见、
不可点，卡片无法折叠为胶囊（[issue #1](https://github.com/bobcat848/dsh-calculator/issues/1)）。

**根因**（层叠上下文问题，非渲染 bug）：

- 插件挂载进框架的 `shell.overlay` 挂载层 `[data-shell-overlay]`
  （`.pI_x6G_overlayLayer`），DSH rc.6 将该层写死为
  `position: absolute; z-index: 20`
- 右侧文件面板列（第三方组件，如 `aionui-explorer-col`）为
  `position: static; z-index: 30` —— 作为同级的 flex 子项，z-index 依然参与
  层叠比较，且 **30 > 20**
- 卡片自身的 `z-index: 1200` 只在挂载层**内部**的层叠上下文生效，无法越过
  同为 `pI_x6G_frame` 子级的文件面板 —— 于是搜索框压住了卡片的 × 按钮

**修复**：插件 CSS 注入一条规则，把挂载层提到 60：

```css
html [data-shell-overlay]{z-index:60}
```

- 用框架的**稳定属性选择器** `[data-shell-overlay]`，不依赖哈希类名；
  特异性 `0-1-1` 高于框架类选择器的 `0-1-0`，无需 `!important`
- **为什么是 60**：> 30（文件面板）解决遮挡；< 100（DSH 模态/弹层）不抢
  模态层级，弹窗、命令面板（z-index: 1000）仍能正常盖住卡片
- 纯 CSS，无需 DOM 轮询 workaround

**后续注意**：

- 若 DSH 未来调整布局 z-index 层级，或引入 z-index ≥ 60 的常驻面板，需要
  重新评估该值（在 30 ~ 100 区间内调整即可，不要超过 100 以免盖住模态层）
- 其他第三方右侧面板若 z-index 高于 60，同样会遮挡卡片；可把 60 调大
  （仍建议 < 100）

### 布局接口版本 — v1.2.0 起

- DSH `0.1.0-rc.6` 的布局**不再提供 `aside` 插槽**（右侧栏），浏览器半从
  v1.2.0 起改为注入框架级 `shell.overlay` 插槽（右上角浮层卡片，可折叠），
  并移除了已不存在的 `ctx.layout.closeAside()`
- **v1.2.0+ 只兼容有 `shell.overlay` 插槽的 DSH 版本**；旧版 DSH（含
  `aside` 插槽）请使用 v1.1.x
- 若升级 DSH 大版本后卡片消失，先检查布局是否仍提供 `shell.overlay`

### 浏览器实测范围

- 实测：Chrome 151（Chromium）。Edge 同为 Chromium 内核，预计行为一致，
  未逐一实测；Safari / Firefox 未验证，如遇样式问题请反馈

## 卸载

```bash
rm -rf ~/.dsh/profiles/node_modules/dsh-calculator
# 并从 ~/.dsh/profiles/web/cordis.patch.yml 删除对应 insert 行
```

## 免责声明

本项目与 DeepSeek 官方无任何关联，价格与余额为接口实时数据，费用为估算。
