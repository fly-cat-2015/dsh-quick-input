# 快捷输入（Quick Input）— DSH 插件

在 DeepSeek Harness Web 的输入框上方加一个【快捷输入】按钮：点开候选弹层，点一条就把它填进输入框。
候选内容在「设置 → 快捷输入」里增、删、改、查，数据落盘在本机，重启和换浏览器都不丢。

- 插件 id：`quick-input`，包名 `@local/dsh-quick-input`
- 形态：标准 DSH bundle（宿主半侧 + 浏览器半侧），纯 JavaScript，无构建步骤
- 语言：中文 / English（跟随 DSH 的 locale 服务）

## 功能

### 1. 输入框上方的【快捷输入】按钮

- **会话进行中**：按钮作为独立一行出现在输入框卡片上方（`conversation.input.dock`），左侧与输入框内容对齐，弹层向上展开。
- **新会话（会话尚未开始）**：按钮自动并入官方的 chip 行，和「工作区 / 模式 / 模型」那几个 chip 同一行、同一套样式（透明胶囊、hover 跟随主题），弹层向下展开。

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
dsh plugin --profile <profile> remove @local/dsh-quick-input
```

> ⚠️ 本插件在本机是 **link 安装**：profile 的 `node_modules` 里是指向本目录的软链。
> 因此不要手动删除或移动本目录；要迁移位置请先卸载、再重新安装。

## 使用

1. 在输入框上方点【快捷输入】（新会话时它在 chip 行里）；
2. 在弹出的候选层里搜索 / 选择一条；
3. 内容被填进输入框，按需编辑后正常发送；
4. 维护列表：设置 → 快捷输入。

首次使用时若还没有数据文件，插件会自动写入 3 条示例（代码审查 / 解释说明 / 补充测试），可随意改删。

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
    { "id": "default-code-review", "label": "代码审查", "content": "请审查下面的代码，指出潜在的 bug、边界情况与可改进点：" }
  ]
}
```

### 宿主路由（浏览器半侧的唯一数据入口）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/dsh-quick-input/items` | 返回 `{ items, path }`；`items: null` 表示还没有文档（浏览器半侧会写入内置示例） |
| `PUT` | `/dsh-quick-input/items` | 请求体 `{ items: [...] }`，落盘后返回 `{ items, path }` |
| `DELETE` | `/dsh-quick-input/items` | 删除文档（即恢复默认），返回 `{ items: null, path }` |

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
├── index.js              # 宿主半侧：数据文件读写 + /dsh-quick-input/items 路由
├── client.js             # 浏览器半侧：共享 store + 输入框按钮/弹层 + 设置页 + 设置菜单图标
├── locale/
│   ├── zh.json           # 插件卡片中文标题/描述
│   └── en.json           # 插件卡片英文标题/描述
└── icon.svg              # 插件卡片图标
```

## 实现要点（二次开发参考）

- **座位选择**：输入框按钮注册在 `conversation.input.dock`。新会话阶段再通过 `createPortal` 把自己投送进官方的 hero chip 行（`[class*="heroWorkspaceRow"]`），因为本 shell 没有声明 `conversation.input.selector.context` 这个「紧随工作区选择器」的加号位。定位只从自己的探针向上走并在同一个 `composerStack` 内校验，用 `MutationObserver` 重新解析；宿主类名若变更则自动退回 dock 行，不会破版。`react-dom` 用 try/catch 获取。做法参考已安装的 `@linxin666/dsh-client-ui-git-graph`。
- **填入输入框**：使用槽位标准 props 里的 `inputActions`（`captureInsertion()` → `insertText()`，失败退回 `setDraft()`），不直接操作 DOM。
- **设置菜单图标**：`settings.section` 只投影 `id / order / label`，外壳也只给内置 id 配图标，其余一律齿轮。因此按 label 精确认领自己的 nav 行，藏掉外壳齿轮、用 `::before` + `mask-image`（`currentColor`）画 ⚡。该绕路方案在 `dshmarket`、`dsh-better-sidebar` 中同样存在，等槽位支持 `icon` 字段后应删除。
- **样式**：只用 `--dsw-alias-*` 语义 token 与宿主的 composer 布局变量（`--dsh-composer-side-clearance` / `--dsh-composer-dock-inset` / `--dsh-composer-card-max-width`，均带兜底值）；类名统一 `dsh-qi-` 前缀；未 import 任何 Harness Client 包。
- **资源归属**：字典注册、locale 订阅、nav 图标观察器、slot 注册全部挂在插件上下文的 `ctx.effect` 上，插件卸载即回收。
- **持久化**：数据由宿主半侧持有（同一 Harness 的所有浏览器共享一份），浏览器半侧只通过同源路由读写。

## 自检

```bash
node --check index.js
node --check client.js
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"

# 宿主路由
curl http://127.0.0.1:3080/dsh-quick-input/items
```

安装后在 Harness 内可用 `cordis_inspect_query`（client / Slots）确认两个槽位的占用：
`conversation.input.dock`（id `quick-input`, order 5）与 `settings.section`（id `quick-input`, order 30）。

## 已知限制

- 设置菜单图标的认领依赖 nav 行的可见文本与当前 label 相同；label 为空时不做任何标记（不会误伤其它行）。
- hero chip 行的定位依赖宿主类名 `heroWorkspaceRow`；宿主改名会退回 dock 行（功能不受影响，只是位置变回独立一行）。
- 会话进行中仍会占用输入框上方一行（这是刻意保留的行为）。
- 暂未实现：拖拽排序、分组/标签、导入导出、变量占位符。
- 未声明开源许可；如需开源请自行补充 `LICENSE` 与 `package.json` 的 `license` 字段。