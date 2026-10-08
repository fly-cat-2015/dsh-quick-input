# 快捷输入（Quick Input）— DSH 插件

在 DeepSeek Harness Web 的输入框上方加一个【快捷输入】按钮：点开候选弹层（**向上展开**），点一条就把它填进输入框。
候选内容在「设置 → 快捷输入」里增、删、改、查，数据落盘在本机，重启和换浏览器都不丢。

- 插件 id：`quick-input`，包名 `@fly-cat-2015/dsh-quick-input`
- 形态：标准 DSH bundle（宿主半侧 + 浏览器半侧），纯 JavaScript，无构建步骤
- 语言：中文 / English（跟随 DSH 的 locale 服务）
- 文案与默认内容：文案在 `locale/*.json`、内置示例在 `content/defaults.json`，改字不用动代码

## 适配版本

### 实机验证过的环境

| 项目 | 版本 |
| --- | --- |
| DSH | `0.1.7-rc.1` |
| profile | `web`（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`） |
| 浏览器半侧依赖的官方包 | `@deepseek-ai/dsh-client-ui-conversation`、`dsh-client-ui-settings`、`dsh-client-ui-settings-general`、`dsh-client-ui-slots`、`dsh-client-locale` 均为 `0.1.7-rc.1` |
| 宿主半侧依赖的服务 | `@deepseek-ai/dsh-host-webserver` `0.1.7-rc.1` |
| Node.js / 平台 | v24.5.0 / macOS (darwin) |

验证日期 2026-09-24。验证范围：槽位注册（`conversation.input.dock`、`settings.section`）、宿主数据路由 CRUD 与落盘播种、客户端 apply 不抛错；界面观感由使用者目视确认。

`package.json` 暂未声明 `engines` / `dsh` 版本区间：本插件用到的宿主契约都是**运行时探测 + 降级**（见下表），硬卡版本反而会挡住可用组合。环境与上表差异较大时，请先看下一节。

### 依赖的宿主契约

| 契约 | 出处 | 缺失 / 变更时的表现 |
| --- | --- | --- |
| `conversation.input.dock` 列表槽位（ownerProps `InputZone`，标准 props 含 `inputActions` / `useInput`） | ui-conversation | 槽位不存在 → 注册失败，输入框上方没有按钮（无降级） |
| `InputActions.captureInsertion()` / `insertText()` / `setDraft()` | ui-conversation `contract/input` | 缺 `insertText` → 退回 `setDraft` 整体填充；两者都缺 → 点选无效果 |
| 新会话 chip 行类名 `heroWorkspaceRow` | ui-conversation `ConversationRoot` | 改名 → 退回「输入框上方独立一行」，功能不受影响 |
| `--dsh-composer-side-clearance` / `--dsh-composer-dock-inset` / `--dsh-composer-card-max-width` / `--dsh-composer-stack-gap` | ui-conversation 的 composer CSS | 缺失 → 用代码内兜底值（16 / 8 / 100% / 6px），仅轻微偏移 |
| `conversation.input.selector.context`（官方「紧随工作区选择器」的加号位） | ui-conversation | **0.1.7-rc.1 未声明**，所以本插件改为 portal 进 chip 行；该槽位出现后可直接注册过去，实现更简单 |
| `settings.section` 槽位（只投影 `id` / `order` / `label`，**没有 icon 字段**） | ui-settings-general | 槽位不存在 → 设置页不出现；日后支持 `icon` → 删掉设置菜单图标的绕路实现 |
| 设置 nav 行结构 `[role="dialog"] nav button`，且行文本 = 当前 label | ui-settings-general `SettingsRoot` | 结构变更 → 设置项退回官方默认齿轮（不破版） |
| nav 内置图标白名单 `account` / `models` / `agent-presets` / `plugins` / `archived-sessions` | ui-settings-general `navIcon()` | 与本插件无关：不在白名单内，这正是需要自行认领并绘制 ⚡ 的原因 |
| `ctx.slots.inject` / `register`、`ctx.effect` | dsh-client-ui-slots / Cordis | 变更 → 插件不加载 |
| `ctx.locale.register` / `bind` / `getLocale` / `subscribe` | dsh-client-locale | 缺失 → 文案回落为 key 本身 |
| 浏览器模块表提供 `react`（必需）与 `react-dom`（投送 chip 用） | dsh-client-modules / `window.__ModuleLoader__` | 无 `react-dom` → 不做投送，留在 dock 行 |
| `ctx.webServer.register({ kind: 'exact', path, handler })` 与 `IncomingMessage` / `ServerResponse` 处理器 | dsh-host-webserver | 变更 → 数据路由注册失败：界面能打开，但读写与**文案/默认内容**都取不到（界面回落为 key 名与空列表） |
| 浏览器模块表只服务插件 JS 产物（`/plugins/<id>/client.*.js`），不服务任意静态文件 | dsh-client-modules | 这是文案必须经宿主路由中转的原因；若日后支持静态资源，可直接 `fetch` 语言文件，本绕路即可删除 |
| `$DSH_HOME` 未设置时取 `~/.dsh` | dsh-home-paths 约定 | 数据目录随之变化 |

### 不适用 / 未验证

- **不适用**：`dsh-headless`、`dsh-acp-app`、`dsh-sdk-*` 等没有 Web 界面的 profile——本插件的两个槽位与数据路由只存在于 Web 组成里。
- **未验证**：更早或更新的 DSH 版本、Windows / Linux、DSH Desktop（Electron）外壳、非 `web` 的 profile 名。
- **可简化时机**：一旦宿主补上 `settings.section` 的 `icon` 字段、或声明 `conversation.input.selector.context` 槽位，本插件的两处绕路实现即可删除（README「实现要点」中均有标注）。

## 功能

### 1. 输入框上方的【快捷输入】按钮

- **会话进行中**：按钮作为独立一行出现在输入框卡片上方（`conversation.input.dock`），左侧与输入框内容对齐。
- **新会话（会话尚未开始）**：按钮自动并入官方的 chip 行，和「工作区 / 模式 / 模型」那几个 chip 同一行、同一套样式（透明胶囊、hover 跟随主题）。
- **弹层一律向上展开**（两种座位都是）：弹层被投送到 `document.body`，按按钮的视口矩形用 `position: fixed` 定位在按钮上方——既躲开输入框卡片（dock 行被压在卡片下面），也不会被输入框的滚动容器裁掉。只有在按钮离视口顶部太近、上方放不下可用高度时，才会临时改为向下展开。

弹层内支持：搜索框过滤、`↑`/`↓` 选择、`Enter` 填入、`Esc` 或点击外部关闭。

点击候选内容后的填入方式：优先通过 InputActions 在**光标处插入**（保留已有内容与选区）；若编辑器拒绝了该 span，则退回整体替换草稿。

### 2. 设置 → 快捷输入（增删改查）

- **增**：名称 + 内容 + 「添加」（`Ctrl/⌘ + Enter` 快捷添加；内容为空会被拦下）
- **查**：列表上方搜索框按名称/内容过滤，右上角显示「共 N 条」
- **改**：行内「编辑」→ 就地修改 → 保存 / 取消
- **删**：两步确认（第一次点变红字「确认删除」，再点才真正删除）
- 另有「恢复默认」（同样两步确认）与数据文件路径显示
- 写入即时生效：设置页保存后，输入框上的弹层立刻能选到新内容（同一份内存 store）

设置菜单里这一项用的是 ⚡ 图标（与输入框上的按钮一致），不是默认的齿轮——原因见「实现要点」。

## 安装

本插件是标准 bundle：`package.json` 里声明了 `dsh.bundle.patch`，安装时会把自己挂进 profile 的 bundle 栈。

1. 在 DSH Web 的「设置 → 插件」中安装本目录，或让 Harness 的插件管理器以本目录的**绝对路径**安装；
2. 安装后刷新页面（浏览器半侧需要重新加载模块）。

安装结果确认：`设置 → 插件` 里能看到「快捷输入」卡片，且输入框上方出现按钮。

### 卸载

```bash
dsh plugin --profile <profile> remove @fly-cat-2015/dsh-quick-input
```

> ⚠️ 本插件在本机是 **link 安装**：profile 的 `node_modules` 里是指向本目录的软链。
> 因此不要手动删除或移动本目录；要迁移位置请先卸载、再重新安装。

## 使用

1. 在输入框上方点【快捷输入】（新会话时它在 chip 行里）；
2. 在弹出的候选层里搜索 / 选择一条；
3. 内容被填进输入框，按需编辑后正常发送；
4. 维护列表：设置 → 快捷输入。

首次使用时若还没有数据文件，插件会自动写入 1 条内置示例（代码审查），可随意改删。

## 文案与默认内容（独立成文件维护）

改字不用碰代码：所有面向用户的文案都在语言文件里，内置示例在 `content/defaults.json` 里。

| 文件 | 内容 | 谁读它 |
| --- | --- | --- |
| `locale/zh.json` | `meta`（插件卡片标题/描述）+ `quickInput`（中文界面全部文案） | `meta`：dsh-app-boot 读插件卡片；`quickInput`：宿主半侧读，见下 |
| `locale/en.json` | 同上，英文 | 同上 |
| `content/defaults.json` | 内置示例条目（`items` 数组，纯文本，不参与翻译） | 宿主半侧，播种与「恢复默认」 |

### 文案是怎么走到界面上的（以及为什么不能直接读文件）

浏览器半侧**不能**自己读这些 JSON：客户端模块加载器只把插件的 JS 产物当资源服务（`/plugins/<id>/client.js` 及其 `client.*.js` chunk），`locale/zh.json` 之类的静态文件一律 404。所以：

1. 宿主半侧启动后读一遍 `locale/` 目录（文件名即语言 id，如 `zh`、`en`、`zh-CN`），把每个文件的 `quickInput` 对象挂在数据路由上；
2. 浏览器半侧 GET `/dsh-quick-input/items` 时同时拿到 `dictionaries`（各语言文案）与 `defaults`（内置示例），再按当前语言把它们注册进 `locale` 服务；
3. 之后 `t('nav')` 取到的就是文件里的字。语言 id 按「中文 id → zh 字典，其它 → en 字典」派发，正好符合 locale 服务的回退链（`zh-CN → en`），所以中文和英文都不会串到 key 名。

翻译行为：**文案不走 `meta`**。`meta` 只给插件卡片用（`dsh-app-boot` 只允许 `meta.title` / `meta.description`，多写的字段会被丢掉），界面文案一律放在同文件的 `quickInput` 里。

新增一种语言：在 `locale/` 下加一个以语言 id 命名的 `.json`（如 `ja.json`），带 `quickInput` 对象即可。
语言文件是**启动时读一次并缓存**的（`locale` 目录里其它不相干的 `.json` 会被忽略），加完文件重启 Harness 生效。

### 内置示例（`content/defaults.json`）

只有一条，首次使用时写进数据文件，也是「恢复默认」写回去的内容：

```json
{ "id": "default-code-review", "label": "代码审查", "content": "帮我审查当前代码变更：指出潜在的 bug、边界情况与可改进点，并给出具体修改建议。" }
```

`label` 是弹层/设置页里显示的名字，`content` 是点选后填进输入框的内容——都是纯文本，不参与翻译（所以中英文环境下看到的是同一份，想分语言维护的话，改成把文案放进语言文件也可以，只是那就不再是「一份默认内容」了）。

## 数据存储

### 位置

```
$DSH_HOME/quick-input/items.json      # DSH_HOME 未设置时为 ~/.dsh
```

默认即 `~/.dsh/quick-input/items.json`。设置页底部会显示当前实际路径。

### 文档结构

```json
{
  "version": 1,
  "updatedAt": "2026-09-24T09:22:19.870Z",
  "items": [
    { "id": "default-code-review", "label": "代码审查", "content": "帮我审查当前代码变更：指出潜在的 bug、边界情况与可改进点，并给出具体修改建议。" }
  ]
}
```

> 这条内容来自 `content/defaults.json`，不是插件代码里的字面量：首次使用时宿主半侧把文件里的示例交给浏览器半侧，后者写入这个文档。改 `defaults.json` 后，对**还没有文档**的机器、以及点过「恢复默认」的机器生效；路由不可用时「恢复默认」会拒绝执行（宁可不动，也不写空列表）。

### 宿主路由（浏览器半侧的唯一数据入口）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/dsh-quick-input/items` | 返回 `{ items, defaults, dictionaries, path }`；`items: null` 表示还没有文档（浏览器半侧会写入内置示例） |
| `PUT` | `/dsh-quick-input/items` | 请求体 `{ items: [...] }`，落盘后返回 `{ items, defaults, dictionaries, path }` |
| `DELETE` | `/dsh-quick-input/items` | 删除文档（即恢复默认），返回 `{ items: null, defaults, dictionaries, path }` |

- `defaults`：内置示例（来自 `content/defaults.json`），每次都带。
- `dictionaries`：各语言文案，形如 `{"en": {...}, "zh": {...}}`，键是语言 id（文件名小写）。只含 `quickInput` 一层，`meta` 不出现在这里。

手工查看 / 重置：

```bash
curl http://127.0.0.1:3080/dsh-quick-input/items
curl -X DELETE http://127.0.0.1:3080/dsh-quick-input/items
```

### 写入约束（宿主半侧强制）

浏览器传来的任何内容都要过一遍白名单净化，坏数据写不进文档：

- `items` 必须是数组，否则 `400`
- 内容为空（仅空白）的条目直接丢弃
- `label` 去空格并截断到 100 字符；`content` 截断到 20000 字符
- 最多 200 条；`id` 缺失或重复时重新分配
- 通过临时文件 + rename 落盘，中断也不会留下半截文档

## 目录结构

```
quick-input/
├── package.json          # bundle 清单：dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # 插入宿主行 quick-input
├── index.js              # 宿主半侧：数据文件读写 + 文案/默认内容读取 + /dsh-quick-input/items 路由
├── client.js             # 浏览器半侧：共享 store + 输入框按钮/向上弹层 + 设置页 + 设置菜单图标
├── locale/
│   ├── en.json           # English：插件卡片 meta + 界面文案 quickInput
│   └── zh.json           # 简体中文：同上
├── content/
│   └── defaults.json     # 内置示例条目（纯文本，不参与翻译）
└── icon.svg              # 插件卡片图标
```

> 内置示例**故意不放在 `locale/`**：`dsh-app-boot` 会把该目录下任何 2–8 个字母的文件名当成语言 id 去读（它读插件卡片文案），`defaults.json` 会被它当成一门叫 “defaults” 的语言。目前无害（文件中没有 `meta`，被忽略），但把数据文件放在那里是隐患，所以单独放 `content/`。

## 实现要点（二次开发参考）

- **座位选择**：输入框按钮注册在 `conversation.input.dock`。新会话阶段再通过 `createPortal` 把自己投送进官方的 hero chip 行（`[class*="heroWorkspaceRow"]`），因为本 shell 没有声明 `conversation.input.selector.context` 这个「紧随工作区选择器」的加号位。定位只从自己的探针向上走并在同一个 `composerStack` 内校验，用 `MutationObserver` 重新解析；宿主类名若变更则自动退回 dock 行，不会破版。`react-dom` 用 try/catch 获取。做法参考已安装的 `@linxin666/dsh-client-ui-git-graph`。
- **弹层向上展开**：dock 行所在的 composer 座位带 `z-index: 7`（`wSkVaW_composerSeat`），输入框卡片画在它上面——弹层挂在按钮旁边会被卡片盖住；`position:absolute` 还会被输入框的滚动容器裁掉。所以弹层 `createPortal` 到 `document.body`，用 `position: fixed` + 按钮 `getBoundingClientRect()` 的视口坐标贴到按钮上方（`placePopup()`）。重算挂在三处：`resize` / `scroll`（含捕获阶段的容器滚动）监听、`visualViewport` 的同样两个事件，以及**弹层自身**的 `ResizeObserver`（列表高度变化时重算；回调经 `requestAnimationFrame` 串联，避免观察自己造成循环）。观察器必须等弹层真正挂载后才创建，所以它单独放在一个以 `open` 为依赖的 effect 里。外部点击判定同时认「chip」与「弹层」两个节点（二者已不在同一棵子树里）。官方 `git-graph` 插件在同一座位是「弹层向下开」，本插件按需求改成两种座位都向上。
- **文案与默认内容**：全部独立成文件（见上文「文案与默认内容」一节），`client.js` 里没有一份可显示的用户文案、也没有内置条目；宿主半侧读文件，浏览器半侧经数据路由取回并注册进 `locale` 服务。注册按语言 id 幂等推进（已注册的 id 不再重复注册——locale 服务对同一 `(namespace, 语言)` 的第二次注册会抛错），卸载时把注册逐个交还。
- **填入输入框**：使用槽位标准 props 里的 `inputActions`（`captureInsertion()` → `insertText()`，失败退回 `setDraft()`），不直接操作 DOM。
- **设置菜单图标**：`settings.section` 只投影 `id / order / label`，外壳也只给内置 id 配图标，其余一律齿轮。因此按 label 精确认领自己的 nav 行，藏掉外壳齿轮、用 `::before` + `mask-image`（`currentColor`）画 ⚡。该绕路方案在 `dshmarket`、`dsh-better-sidebar` 中同样存在，等槽位支持 `icon` 字段后应删除。
- **样式**：只用 `--dsw-alias-*` 语义 token 与宿主的 composer 布局变量（`--dsh-composer-side-clearance` / `--dsh-composer-dock-inset` / `--dsh-composer-card-max-width`，均带兜底值）；类名统一 `dsh-qi-` 前缀；未 import 任何 Harness Client 包。
- **资源归属**：locale 订阅、nav 图标观察器、slot 注册全部挂在插件上下文的 `ctx.effect` 上，插件卸载即回收。
- **持久化**：数据由宿主半侧持有（同一 Harness 的所有浏览器共享一份），浏览器半侧只通过同源路由读写。

## 自检

```bash
node --check index.js
node --check client.js
node -e "for (const f of ['package.json','locale/zh.json','locale/en.json','content/defaults.json']) JSON.parse(require('fs').readFileSync(f,'utf8'))"

# 宿主路由（应同时看到 items / defaults / dictionaries / path）
curl http://127.0.0.1:3080/dsh-quick-input/items
```

安装后在 Harness 内可用 `cordis_inspect_query`（client / Slots）确认两个槽位的占用：
`conversation.input.dock`（id `quick-input`, order 5）与 `settings.section`（id `quick-input`, order 30）。

## 已知限制

- 设置菜单图标的认领依赖 nav 行的可见文本与当前 label 相同；label 为空时不做任何标记（不会误伤其它行）。
- hero chip 行的定位依赖宿主类名 `heroWorkspaceRow`；宿主改名会退回 dock 行（功能不受影响，只是位置变回独立一行）。
- 会话进行中仍会占用输入框上方一行（这是刻意保留的行为）。
- 弹层默认向上展开；按钮离视口顶部不足约 160px 时会临时向下开（否则上方放不下可用高度）。
- 语言文件在启动时读一次并缓存：新增/修改 `locale/*.json` 需要重启 Harness；浏览器端刷新页面只会重新取一遍宿主已缓存的内容。
- 若宿主路由不可用（网络/后端异常），界面会回落到 key 名与空列表：文案只有宿主这一份来源，代码里刻意不留副本。首次加载会重试 3 次（覆盖「浏览器先到、路由后注册」的冷启动竞态），之后打开弹层或进入设置页也会再试一次；恢复默认在拿不到内置示例时直接拒绝执行。
- 暂未实现：拖拽排序、分组/标签、导入导出、变量占位符。
- 未声明开源许可；如需开源请自行补充 `LICENSE` 与 `package.json` 的 `license` 字段。