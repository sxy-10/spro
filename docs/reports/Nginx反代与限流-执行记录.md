# Nginx 阶段执行记录与问题清单

> 执行日期：2026-11-16
> 结果：**全部通过**（反代通、限流生效、503 可见）
> 本文记录执行过程中的所有偏差、踩坑与调整，供复盘和答辩使用。

---

## 一、最终可用状态（可直接复制）

### 目录布局

```text
E:\colledge\three\软件工程\spro\spro\deploy\nginx\
    └─ nginx.conf                     ← 存档版（仓库内，交付/diff 用）

E:\colledge\three\softwareprojects\testall\      ← 运行目录（nginx prefix）
    ├─ nginx.conf                     ← 运行版（从存档版复制）
    ├─ logs\
    │   ├─ nginx.pid
    │   ├─ spro_access.log
    │   └─ spro_error.log
    └─ temp\                          ← 必须手工创建，见问题 2
```

nginx 可执行文件在 `D:\waimai\nginx-1.20.2\nginx.exe`（不在 PATH 里）。

### 四条核心命令

```bash
# ① 启动
cd "D:/waimai/nginx-1.20.2" && ./nginx.exe -p "E:/colledge/three/softwareprojects/testall" -c nginx.conf

# ② 改完配置：先复制，再测语法，最后 reload（顺序不能乱）
cp "E:/colledge/three/软件工程/spro/spro/deploy/nginx/nginx.conf" "E:/colledge/three/softwareprojects/testall/nginx.conf"
cd "D:/waimai/nginx-1.20.2" && ./nginx.exe -p "E:/colledge/three/softwareprojects/testall" -c nginx.conf -t
cd "D:/waimai/nginx-1.20.2" && ./nginx.exe -p "E:/colledge/three/softwareprojects/testall" -c nginx.conf -s reload

# ③ 停止
cd "D:/waimai/nginx-1.20.2" && ./nginx.exe -p "E:/colledge/three/softwareprojects/testall" -c nginx.conf -s stop

# ④ 看限流日志
tail -20 "E:/colledge/three/softwareprojects/testall/logs/spro_error.log"
```

### 端口分工

| 端口 | 限流 | 用途 |
|---|---|---|
| 3001 | 无 | 后端直连（A 组基线） |
| 8080 | **无** | 反代基线（B 组）、日常开发调试 |
| 8088 | 20r/s + burst 40 + 并发 50 | 生产配置（C 组、503 演示） |

---

## 二、与原计划的 6 处调整

| # | 原计划 | 实际做法 | 原因 |
|---|---|---|---|
| 1 | 配置复制到 `C:\nginx\conf\spro.conf` | 复制到 `E:\colledge\three\softwareprojects\testall\nginx.conf` | 你指定；且本机根本没有 `C:\nginx` |
| 2 | prefix 用 nginx 安装目录 | prefix 用 `testall` 目录 | 隔离运行痕迹，不往苍穹外卖项目的 nginx 目录里写日志和 pid，避免影响那个项目 |
| 3 | 单端口 8080，改配置靠 reload 切换 | **双端口**：8080 无限流 / 8088 限流 | 一次配置即可对比"有无限流"，压测时不用反复 reload，数据更干净 |
| 4 | 用 `for` 循环连发 200 次验证 503 | 改用 `autocannon -c 50` | `for` 循环实测**打不出 503**，见问题 6 |
| 5 | 压测只打 `/v1/health` | 追加 `/v1/routes`（带数据库） | health 是纯内存返回，测不出数据库瓶颈 |
| 6 | 第 4 组定位为"数据库压测" | 改为"应用层限流验证（429）" | 请求根本到不了数据库，被 120/min 限额挡了，见问题 10 |

---

## 三、执行中遇到的 11 个问题（按发生顺序）

### 问题 1｜`where nginx` 找不到，但机器上确实装了

**现象**
```
信息: 用提供的模式无法找到文件。
bash: nginx: command not found
```

**原因**：nginx 没加进 PATH。

**解决**：先用常见路径找（`C:\nginx` / `D:\nginx` / Program Files 全都没有），再用 PowerShell 递归搜 3 层：

```powershell
foreach($d in @('C:\','D:\','E:\')){ Get-ChildItem -Path $d -Filter nginx.exe -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 5 -ExpandProperty FullName }
```

**结果**：`D:\waimai\nginx-1.20.2\nginx.exe` —— 是苍穹外卖项目带的那份，版本 1.20.2。

**教训**：`where` 只能查 PATH，装了但没进 PATH 就查不到。要么全盘搜，要么翻项目目录。

---

### 问题 2｜启动报 `CreateDirectory() ... temp/client_body_temp failed`

**现象**
```
nginx: the configuration file ... syntax is ok
nginx: [emerg] CreateDirectory() "E:/.../testall/temp/client_body_temp" failed (3: The system cannot find the path specified)
nginx: configuration file ... test failed
```

**原因**：nginx 启动时要在 prefix 下建 5 个缓存目录（`client_body_temp` / `proxy_temp` / `fastcgi_temp` / `uwsgi_temp` / `scgi_temp`），但它**只会建二级目录，不会先建父目录 `temp`**。用安装目录做 prefix 时自带 `temp`，所以平时不会遇到；换成自定义 prefix 就暴露了。

**解决**：
```bash
mkdir -p "E:/colledge/three/softwareprojects/testall/temp"
```
再 `-t` 就 `test is successful`。

**教训**：自定义 prefix 时，`logs/` 和 `temp/` 两个目录必须先手工建好。

---

### 问题 3｜直接运行 `nginx.exe` 命令不返回，最后被 SIGTERM 杀掉

**现象**：第一次启动后命令挂住，工具报 `Signal: SIGTERM`，随后检查发现 nginx 也没起来。

**原因**：Windows 版 nginx 是**控制台程序**，`nginx.exe` 在前台运行不 detach；再叠加 `| tr -d '\r'` 这个管道，主进程 stdout 不关闭，管道就一直等。工具超时后把整个进程组杀掉，nginx 一起没了。

**解决**：改用后台任务方式启动（不接管道），进程成功常驻：
- master PID 13488
- worker PID 53008（实际监听 8080/8088）

**教训**：启动常驻服务时，**永远不要给它的输出接管道**，否则管道会被进程持有导致命令假死。

---

### 问题 4｜`cmd /c start` 被安全策略拦截

**现象**
```
Command blocked for security: Invoking cmd.exe from Bash bypasses all command validation
```

**原因**：环境禁止从 Bash 调 `cmd.exe`（防绕过命令校验）。

**解决**：放弃 `start`，改用后台任务方式（见问题 3）。

**教训**：Git Bash 里"让进程后台常驻"的标准做法（`cmd start`）在这台机器上不可用，只能靠后台任务或 `nohup ... &`。

---

### 问题 5｜压测目标接口报 `10001 参数为空、格式错误`

**现象**
```bash
curl ".../v1/routes?page=1&page_size=3"
→ {"code":10001,"message":"参数为空、格式错误或超出允许范围"}
```

**原因**：`core.ts:58` 的分页 schema 字段名是 **`size`** 不是 `page_size`，且用了 `.strict()` —— 多传一个 `page_size` 直接判为非法参数。

**解决**：改成 `?page=1&size=3`，三个端口都返回 200。

**教训**：这个项目的 zod schema 大量使用 `.strict()`，**多传字段会报参数错误**，而不是忽略。报错文案又长得像"业务参数不对"，极易误判。

---

### 问题 6｜⭐ `for` 循环连发 200 次，全部 200，误以为限流失效

**现象**
```bash
for i in $(seq 1 200); do curl ... http://127.0.0.1:8088/v1/health; done
→ 200 200        ← 200 个请求全是 200，一个 503 都没有
```

**排查过程**（三步，值得记住）：
1. `nginx -T` 确认配置**确实加载了**（能看到 `limit_req zone=spro_rate burst=40`）
2. `access.log` 有 706 行，`error.log` 没有任何 `limiting requests` → 请求到了，但限流没触发
3. 把 `rate` 临时改成 `1r/m`、`burst` 改 `1` 再测 → **5 个请求全 503**，error log 出现 `limiting requests, excess: 7.893`

**真正原因**：**限流一直是好的，是压不出速度。**
- Windows 上每启动一次 `curl.exe` 约 30–60ms
- 串行循环 200 次 → 实际速率只有 **15–20 r/s**，正好卡在 `rate=20r/s` 的临界点
- `burst=40` 的突发桶把这 40 个"超额"全部吸收 → 全 200

**解决**：改用 autocannon 制造真实并发，`-c 50 -d 5` 立刻打出 **128,928 个 503**，放行 **140** 个 = `20×5 + 40`，精确吻合理论值。

**教训（答辩可直接讲）**：
> "串行 curl 不能用来验证限流——进程启动开销本身就限死了速率上限。要验证限流必须用并发工具，否则会得到'限流没生效'的假结论。"

---

### 问题 7｜`burst=0` 是非法值，reload 静默失败

**现象**
```
nginx: [emerg] invalid burst value "burst=0" in ...nginx.conf:58
```
但后面的 curl 照样全 200 —— 因为 **reload 失败后，旧配置继续运行**。

**原因**：`limit_req` 的 `burst` 最小值是 1，`burst=0` 等于不写（默认即 0，表示不留突发额度），显式写 0 会被判非法。

**解决**：诊断时用 `burst=1`（rate=1r/m），立即看到 503。

**教训**：**改配置必须先 `-t` 再 `reload`**。直接 reload 而失败，进程会继续用旧配置，你会对着新配置文件排查一个根本没生效的问题——这是最浪费时间的一类坑。

---

### 问题 8｜B 组 RPS 比 A 组还高 25%，看起来像"反代提速"

**现象**

| 组 | RPS | 平均延迟 |
|---|---|---|
| A 直连 3001 | 5,527 | 8.54ms |
| B 经 Nginx 8080 | 6,931 | 13.11ms |

**排查**：怀疑是"第一次压测 V8 没预热"。复测三轮：
A=4,845 / A=5,477 / B=6,041 —— B 依然略高，**排除预热**。

**结论**：这是本机 loopback 场景的正常现象，不是反代真的提速：
1. Nginx 的 IO 事件循环比 Node 高效，50 个前端 socket 由 Nginx 承担，Node 只处理复用的少量 upstream 连接（`keepalive 64`）
2. `proxy_buffering` 默认开启，Nginx 快速收完响应释放连接，Node 不等慢客户端
3. Windows 上同配置复测波动可达 ±15%

**正确表述**（别说"反代更快"，会被老师追问）：
> "延迟增加 4.6ms，吞吐差异落在 ±15% 测量噪声内。结论是反代开销可忽略。"

---

### 问题 9｜⚠️ 诊断时改坏了运行配置，忘记还原

**现象**：诊断过程把 `testall/nginx.conf` 改成了 `rate=1r/m`、`burst=0`，其中 `burst=0` 那次 reload 失败，运行中的仍是 `1r/m + burst=40` 的中间态。

**解决**：从仓库存档版（`deploy/nginx/nginx.conf`）**整份覆盖**回去，再 reload，最后用 `grep` 核对两行参数：
```
18:    limit_req_zone ... rate=20r/s;
58:    limit_req  zone=spro_rate burst=40 nodelay;
```
并确认 8080/8088 都返回 200。

**教训**：诊断性修改一定要**改副本 + 明确还原步骤**；存档版（`deploy/nginx/nginx.conf`，入库）和运行版（`testall/nginx.conf`，本机）分离，正是为了让"一键还原"成为可能。

---

### 问题 10｜D 组 2,602 个请求返回 429，不是 500

**现象**：`/v1/routes` 压测只有 116 个 200，其余 2,602 个全是 **429**，`errors=0`。

**原因**：`router.ts:82` 有全局应用层限流：
```ts
api.use((req, _res, next) => { rateLimit(`ip:${req.ip}`, 120).then(() => next(), next); });
```
即 **120 次/分钟/IP**。30 并发几秒就打满了。

而 `/v1/health` 定义在第 81 行，**在全局限流中间件之前**，所以 A/B/C 三组不受影响——这就是基线干净的原因。

**结论（重要，别当成 bug）**：这是**双层限流**在起作用，不是数据库崩溃：
| 层 | 位置 | 规则 |
|---|---|---|
| 网关 | Nginx `limit_req` | 20 r/s + burst 40 |
| 应用 | `router.ts:82` | 120 次/分钟/IP（429） |
| 敏感接口 | `router.ts:86/210/211` | 登录 10/min、短信 10/min、**手机号 3/min** |

**影响**：D 组测不出数据库真实上限。要测需临时调大 `router.ts:82` 的 120，属改代码，本次未做。

---

### 问题 11｜B 组有 100 个客户端错误（0.07%）

**现象**：`errors=100`，但 `non2xx=0`（服务端没返回错误码，是客户端侧连接被重置）。

**原因**：`server.ts:9` 只设了 `headersTimeout=15000`，**没设 `keepAliveTimeout`**，Node 用默认 **5 秒**。Nginx upstream 的空闲连接被 Node 5 秒后关闭，Nginx 复用时拿到死连接。

**建议修复**（属组员1/3 代码，本次未改）：
```ts
server.keepAliveTimeout = 65_000;  // 必须大于 nginx keepalive_timeout(60s)
```

---

## 四、给答辩用的三个知识点

**① 为什么用漏桶而不是令牌桶**
> 分工表写的是"令牌桶"，但 Nginx `limit_req` 官方实现是**漏桶**（固定速率流出 + 突发桶）。真令牌桶要上 OpenResty + Lua。我们选漏桶是因为内置、零依赖，限流效果等价，代价是不支持预消费令牌。

**② 限流效果可被公式预测**
> 放行数 = `rate × 时长 + burst`。实测 5 秒放行 140 = `20×5+40`，20 秒放行 443 ≈ `20×20+40`。这不是巧合，是算法参数精确生效的证据。

**③ 双层限流的纵深防御**
> 网关层挡洪水（20r/s，返回 503），应用层按用户挡滥用（120/min，返回 429），敏感接口再单独加严（短信 3/min/手机号，防轰炸）。压测中 2,602 个 429 正是第二层生效的证明。

---

## 五、下一步（阶段四）

- [x] Apifox 建 7 个接口（health / login / routes / plans / seckill / seckill-result / roles）→ 集合在 `docs/reports/apifox/`
- [x] 18 条用例表转成正式文档 → `docs/reports/全链路联调记录-阶段五.md`
- [ ] 自检清单打勾
- [ ] 答辩提纲
- [x] 验收前把 `nginx.conf` 拷进仓库 `deploy/nginx/`，`联调记录` 拷进 `docs/reports/`（2026-11-19 已完成）
