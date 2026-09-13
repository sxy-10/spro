# ✈️ 旅游规划智能体系统 (AI Travel Agent System) - 项目脚手架

## 🎯 项目定位与愿景
基于大模型 + 智能体（Agent）的全自动个性化旅行规划系统。  
**一句话能力**：告诉它 **“去哪、几天、几人、预算”**，AI 智能体自动查、自动算、自动排、自动生成完整可落地的出行方案。

---

## 📂 目录结构与架构设计

```text
旅游规划/
├── package.json               # 根项目管理脚本（一键安装依赖/并发启动）
├── .gitignore                 # Git 忽略配置
├── README.md                  # 项目脚手架与架构说明文档
│
├── backend/                   # 智能体后端服务 (Node.js + TypeScript + Express)
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example           # 环境变量示例（含大模型 API Key、高德、天气配置）
│   └── src/
│       ├── server.ts          # 服务入口与健康检查
│       ├── models/
│       │   └── types.ts       # 偏好、行程单、预算分配、工具调用等全套数据契约
│       ├── agent/
│       │   ├── planner.ts     # 核心规划智能体（偏好识别、全自动按天排程、微调重排）
│       │   ├── tools.ts       # 五大工具层：景/交/宿/气/食（支持 Mock 与真实 API 扩展）
│       │   └── prompts.ts     # 系统提示词与 Few-Shot 意图提取模版
│       └── routes/
│           ├── chatRouter.ts      # 自然语言一句话规划接口
│           ├── itineraryRouter.ts # 行程多轮重排优化、微信长文/打印导出
│           └── adminRouter.ts     # 旅行社/企业端线路产品管理与数据分析统计
│
└── frontend/                  # 现代前端交互界面 (Vite + React + TypeScript)
    ├── package.json
    ├── vite.config.ts         # Vite 配置（内置代理 /api 到后端 3001 端口）
    ├── tsconfig.json
    ├── index.html
    └── src/
        ├── main.tsx           # 前端启动挂载点
        ├── App.tsx            # 对话面板、按天时间轴看板、导出预览弹窗、管理端切页
        └── styles.css         # 纯净现代 UI 样式库
```

---

## 🧭 11 大功能模块实现对照表

| 序号 | 需求功能 | 脚手架中对应的文件与实现模块 |
| :--- | :--- | :--- |
| **1** | **智能体入口** | `backend/src/routes/chatRouter.ts` + `frontend/src/App.tsx` (自然语言输入与提取) |
| **2** | **全自动行程生成** | `backend/src/agent/planner.ts` (`generatePlan` 动线顺路规划，按上午/下午/晚上/住/行/餐生成) |
| **3** | **实时信息获取** | `backend/src/agent/tools.ts` (封装门票/交通/酒店/天气/特色美食 5 类工具) |
| **4** | **交通智能规划** | `AgentToolSet.compareTransportation` (高铁/机票/市内换乘建议) |
| **5** | **住宿智能推荐** | `AgentToolSet.recommendHotels` (匹配预算、近景点/地铁优势) |
| **6** | **美食与体验推荐** | `AgentToolSet.findLocalFoods` (特色菜品、顺路餐厅、忌口过滤) |
| **7** | **行程一键导出** | `backend/src/routes/itineraryRouter.ts` (`/export` 导出长文与排版打印) |
| **8** | **行程编辑与再优化** | `backend/src/routes/itineraryRouter.ts` (`/optimize` 接收指令重新计算) |
| **9** | **旅行锦囊与避坑** | `TravelPlanItinerary.essentialKitAndNotices` (着装、防坑点、紧急医疗/报警电话) |
| **10** | **多目的地与自驾** | `UserTravelPreference.destinationCities` 循环遍历连线与跨城调度 |
| **11** | **后台管理系统** | `backend/src/routes/adminRouter.ts` (线路库管理、转化率与客流统计看板) |

---

## 🚀 快速启动指南

### 1. 安装依赖
在项目根目录下直接运行：
```powershell
# 一键安装根目录、后端及前端的所有依赖
npm run install:all
```

### 2. 启动开发服务
```powershell
# 根目录下同时启动后端 (3001) 与前端 (3000)
npm run dev
```
启动成功后访问前端：`http://localhost:3000`

---

## ⚙️ 接入真实大模型与第三方 API

复制后端环境配置：
```powershell
cd backend
copy .env.example .env
```
并在 `.env` 中填入你的大模型配置（兼容 OpenAI、DeepSeek、通义千问、Kimi 等标准接口）：
```env
LLM_API_KEY=sk-xxxxxx
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```
当切换为真实 API 时，可在 `backend/src/agent/tools.ts` 中直接接入高德地图 API（路径规划、POI 搜索）和天气服务 API。
