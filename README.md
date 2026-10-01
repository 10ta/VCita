# 🔥 VocabForge

极简的自托管背单词工具：输入单词自动翻译，SM-2 间隔重复，数据存为本地 JSON 文件。

无需账号，无需 API Key，单个 React 文件 + 一个 Vite 插件。

## 功能

- **输入即翻译**：回车立即入库，后台调用 Google 翻译回填两种目标语言，可连续输入
- **SM-2 间隔重复**：四级评分（重来 / 困难 / 良好 / 简单），间隔随作答表现动态调整，按钮上直接显示下次间隔
- **每日上限**：新卡数、复习数分别限制，积压不会一次性压过来
- **本轮重练**：点"重来"的卡在本轮末尾再出现一次
- **撤销 + 快捷键**：全键盘操作，可撤销最近 20 次作答
- **强化练习**：按"记错过"或标签集中练习，不影响复习排期
- **发音**：服务端代理 Google TTS
- **多牌组 / 多用户 / 标签 / 卡片旋转**（三个字段轮流当题面）
- **导出 / 导入**：单个 JSON 文件备份与恢复

## 快速开始

```bash
git clone https://github.com/YOUR_USERNAME/vocab-forge.git
cd vocab-forge
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:31777/vocab-forge/`。

### 反向代理（Caddy，子路径部署）

```caddyfile
handle /vocab-forge {
    redir /vocab-forge/ permanent
}
handle /vocab-forge/* {
    reverse_proxy localhost:31777
}
```

> ⚠️ 应用本身**没有任何鉴权**。暴露到公网前，请在代理层加访问控制（Basic Auth、Cloudflare Access 等），否则知道网址的人都能读写你的词库。

### PM2 守护

```bash
pm2 start npm --name "vocab-forge" -- run dev
pm2 save
pm2 startup        # 按提示执行输出的 sudo 命令，实现开机自启
```

常用命令：

```bash
pm2 list                   # 查看进程
pm2 restart vocab-forge    # 重启
pm2 stop vocab-forge       # 停止
pm2 delete <id>            # 删除（同名进程有多个时按 id 删）
pm2 save                   # 修改进程列表后记得保存
```

修改 `vite.config.js` 后 Vite 会自动重启；若配置有语法错误，Vite 会继续运行旧配置，看 `pm2 logs vocab-forge` 排查。

## 配置

所有配置都在 `vite.config.js` 顶部，改完刷新页面生效。

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `SOURCE_LANG` / `TARGET_LANG_1` / `TARGET_LANG_2` | `fr` / `zh-CN` / `en` | 新用户的默认语言，界面右上角可随时切换 |
| `NEW_CARDS_PER_DAY` | `20` | 每个牌组每天最多引入的新卡 |
| `REVIEWS_PER_DAY` | `200` | 每个牌组每天最多复习的到期卡 |
| `NEW_CARD_POSITION` | `'mix'` | 新卡位置：`mix` 穿插 / `first` 先学 / `last` 复习完再学 |
| `REVIEW_ORDER` | `'due'` | 到期卡顺序：`due` 最早到期优先 / `random` 随机 |
| `RELEARN_IN_SESSION` | `true` | "重来"的卡是否在本轮末尾再出现 |
| `STARTING_EASE` | `2.5` | 新卡初始难度系数 |
| `EASY_BONUS` | `1.3` | "简单"的额外乘数 |
| `HARD_FACTOR` | `1.2` | "困难"的间隔乘数 |
| `MAX_INTERVAL_DAYS` | `3650` | 最长间隔 |
| `HOST` / `PORT` / `BASE_PATH` | `127.0.0.1` / `31777` / `/vocab-forge` | 监听地址与子路径 |
| `DATA_DIR` | `data` | 数据目录 |
| `SHOW_SOURCE` / `SHOW_TARGET_1` / `SHOW_TARGET_2` | | 词库列表默认显示哪些字段 |
| `PAGE_SIZES` / `DEFAULT_PAGE_SIZE` | | 词库分页 |
| `AUTO_PLAY_ADD` / `AUTO_PLAY_REVIEW` | `false` | 添加 / 复习时自动发音 |

## 复习算法（SM-2）

每张卡记录 **间隔**（天）、**倍率** ease、**下次复习日期**、**遗忘次数**。复习时先显示答案，再按记忆情况评分，按钮上显示选这个评分后多久再出现：

| 评分 | 新卡 | 已学过的卡 |
|---|---|---|
| 重来 `1` | 明天再复习 | 间隔重置为 1 天，ease −0.2，遗忘次数 +1 |
| 困难 `2` | 明天 | 间隔 × 1.2，ease −0.15 |
| 良好 `3` | 明天 | 间隔 × ease |
| 简单 `4` | 4 天后 | 间隔 × ease × 1.3，ease +0.15 |

- 倍率（ease）最低 1.3，越低说明这张卡越难记，间隔增长越慢
- 逾期复习仍答对时，逾期天数会计入新间隔（与 Anki 一致），所以积压很久的卡答对后间隔会拉得很长；如果其实记得很勉强，请选"困难"或"重来"
- 间隔 ≥ 3 天时加 ±5% 随机抖动，避免同一天加的卡永远挤在同一天到期
- "本轮重练"只是练习，不会再次改动排期

### 从旧版（固定艾宾浩斯日程）升级

首次加载时自动完成，无需手动操作：

- 有复习记录的卡：按历史逐条回放（绿 = 良好，红 = 重来），推算出当前间隔与下次复习日期
- 从未复习的卡：变为新卡，按每日新卡上限逐步引入
- 升级结果自动写回数据文件，顶部提示升级了多少张

**升级前请先在"备份"页导出一份。**

## 快捷键

| | 复习 | 强化 |
|---|---|---|
| `空格` / `回车` | 显示答案；已显示时 = 良好 | 显示答案；已显示时 = 下一个 |
| `1` – `4` | 评分 | `1` 再练，`2`–`4` 下一个 |
| `U` / `Ctrl+Z` | 撤销上一次 | |
| `S` / `→` | 跳过（留到下次） | `←` `→` 切换 |
| `M` | | 已掌握（移出高难度） |
| `?` | 打开 / 关闭说明 | 同左 |

在输入框中打字时快捷键不生效。页面右上角 `?` 按钮有所有标签和按钮的含义说明。

词库列表：点卡片空白处即可切换选中，按钮、输入框、拖选文字不会触发。

## 强化练习

- **高难度**：复习历史中出现过"重来"的卡
- **标签**：任意标签下的卡
- 纯练习，不改变复习排期；"已掌握"会把这张卡的红色记录改为绿色，移出高难度

## 数据存储

```
data/
├── global.json                     # 用户列表、当前用户
└── users/<uid>/
    ├── meta.json                   # 牌组、语言设置
    └── YYMM/MMDD.json              # 按卡片创建日期分文件，每个文件是卡片数组
```

卡片结构：

```jsonc
{
  "id": "m1abc2de",
  "word": "inchangé", "translation": "不变", "translation2": "unchanged",
  "deckId": "default", "createdAt": "2026-09-10", "tags": [], "rot": 0,
  "state": "review",          // new | review
  "interval": 12, "ease": 2.35, "due": "2026-10-13",
  "lapses": 1, "reps": 5, "lastReview": "2026-10-01",
  "reviewHistory": [{ "date": "2026-10-01", "rating": 3, "remembered": true, "interval": 12 }]
}
```

前端把全部卡片加载进内存，修改后 400ms 合并成一次 `/api/sync` 写盘；服务端按用户加写锁，原子写入（临时文件 + rename）。多设备同时使用时，切回标签页会自动检查并拉取其他设备的改动。

服务端接口（`vite.config.js` 内的插件实现）：

| 接口 | 用途 |
|---|---|
| `GET /api/snapshot?uid=` | 一次返回用户全部数据 |
| `POST /api/sync` | 批量合并写入日文件 |
| `GET /api/rev?uid=` | 数据版本号 |
| `POST /api/read` `/write` `/delete`、`GET /api/list` | 单文件读写（导入导出用） |
| `GET /api/tts?q=&tl=` | 发音代理 |

## 备份

**方式一**：备份页点 Export，下载 `vocabforge-YYYY-MM-DD.json`；恢复时点 Import 选择该文件。

**方式二**：直接把 `data/` 目录纳入 git：

```bash
git add data
git commit -m "vocab backup $(date +%F)"
git push
```

## 调试

- 页面顶部"● 保存中 / 保存失败·重试中"显示写盘状态
- 运行日志存在浏览器 localStorage（`vf_logs`），备份页可导出
- 服务端错误看 `pm2 logs vocab-forge`
- 无法解析的数据文件会被改名为 `*.corrupt-时间戳` 保留，不会被覆盖

## 项目结构

```
vocab-forge/
├── index.html
├── package.json
├── vite.config.js      # 配置 + 文件存储 API 插件
├── src/
│   ├── main.jsx
│   └── App.jsx         # 全部前端逻辑（单文件）
└── data/               # 词库数据（运行后生成）
```

## License

MIT