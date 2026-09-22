import {
  DetailedItinerary,
  ChatMessageItem,
  ExploreMapPin,
  ExploreCollectionItem,
  AdminMetricsData
} from './types';

export const defaultPrototypeItinerary: DetailedItinerary = {
  planId: 'plan_yunnan_001',
  title: '云南5天4晚方案',
  subTagText: '跨省双城 · 自由行 · 慢调度假 · 无购物',
  routeText: '成都 ➔ 昆明 · 大理 · 丽江',
  durationSummary: '5天4晚',
  budgetSummaryRmb: 7890,
  judgeOptimalityScore: '0回头路',
  judgeCertification: {
    statusTitle: '行程判官认证：无硬伤',
    detailMessage: '景点闭环顺路，单日车程≤3.5h，已避开玉龙雪山周三例检。',
    verifiedBadgeText: '已认证 判官'
  },
  days: [
    {
      dayIndex: 1,
      dayLabel: 'D1 昆明春城',
      cityTheme: '初抵春城·老街滇味',
      weatherText: '晴',
      temperatureText: '22℃',
      weatherIcon: '☀️',
      items: [
        {
          timeString: '10:30 大交通',
          category: 'transport',
          badgeText: '航班直飞',
          title: '成都双流/天府 ➔ 昆明长水',
          description: '用时 1小时35分 · 航班准点率 94%',
          highlightReason: '落地转乘机场快线直达翠湖核心片区'
        },
        {
          timeString: '12:30 午餐',
          category: 'meal',
          badgeText: '非遗滇味',
          title: '建新园·传统过桥米线',
          description: '百年老店，高汤滚烫锁鲜，配料丰富',
          metricsText: '人均 ¥35 | 招牌: 菊花过桥米线、冷脆鸡'
        },
        {
          timeString: '14:30 漫游',
          category: 'attraction',
          badgeText: '城市漫步',
          title: '翠湖公园 ➔ 黄公东街 ➔ 昆明老街',
          description: '步行林荫道，打卡黄色复古法式建筑与光华街老茶馆',
          highlightReason: '单日步数轻量控制在 8,000 步以内'
        }
      ]
    },
    {
      dayIndex: 2,
      dayLabel: 'D2 洱海漫游',
      cityTheme: '洱海慢调·苍山环抱',
      weatherText: '多云',
      temperatureText: '21℃',
      weatherIcon: '⛅',
      items: [
        {
          timeString: '08:30 大交通',
          category: 'transport',
          badgeText: '高铁快速直达',
          title: '昆明南站 ➔ 大理站 (D8712)',
          description: '用时 2小时10分 · 二等座 ¥145/人 (智能比价早班首发无空档)',
          highlightReason: '排班理据: 出站即有首发定制直通车直达洱海东'
        },
        {
          timeString: '11:45 午餐',
          category: 'meal',
          badgeText: '本地特色美食',
          title: '段公子·野生菌铜锅土鸡煲',
          description: '榜单好评: 慢熬汤底适合温补，不泼辣。距离位于古镇主路口。',
          metricsText: '人均 ¥68 | 推荐菜: 松茸土鸡汤、包浆豆腐'
        },
        {
          timeString: '14:00 景点',
          category: 'attraction',
          badgeText: '生态景观',
          title: '洱海生态廊道骑行 (双廊至磻溪S湾)',
          description: '顺光取景，避开传统大巴旅行团拥挤时段',
          highlightReason: '无机动车干扰，沿途设官方骑行驿站'
        },
        {
          timeString: '18:30 入住',
          category: 'hotel',
          badgeText: '一线海景',
          title: '大理双廊澜庭海景度假客栈',
          description: '亲水临湖客房，含双人露台落日轻下午茶',
          metricsText: '约 ¥680/晚 · 评分 4.9 分'
        }
      ]
    },
    {
      dayIndex: 3,
      dayLabel: 'D3 丽江慢调',
      cityTheme: '古城夜色·木府风云',
      weatherText: '多云转晴',
      temperatureText: '19℃',
      weatherIcon: '🌤️',
      items: [
        {
          timeString: '09:30 交通',
          category: 'transport',
          badgeText: '观光专列',
          title: '大理 ➔ 丽江 (双层旅游专列)',
          description: '用时 1.5 小时 · 穿行苍山洱海田园画卷',
          highlightReason: '全景观光玻璃车窗，沿途风光极佳'
        },
        {
          timeString: '12:00 午餐',
          category: 'meal',
          badgeText: '纳西风味',
          title: '阿妈腊排骨纳西土菜馆',
          description: '腌制三年土猪腊排骨，搭配野生韭菜根与水性杨花',
          metricsText: '人均 ¥72 | 推荐: 经典腊排骨砂锅'
        },
        {
          timeString: '15:00 漫游',
          category: 'attraction',
          badgeText: '人文遗产',
          title: '木府 ➔ 忠义市场 ➔ 大研古城狮子山',
          description: '登顶万古楼俯瞰全城黑瓦木楼，远眺玉龙雪山倒影',
          highlightReason: '判官审查: 避开晚高峰酒吧街喧嚣路段'
        }
      ]
    },
    {
      dayIndex: 4,
      dayLabel: 'D4 玉龙雪山',
      cityTheme: '冰川圣洁·蓝月纯净',
      weatherText: '晴冷',
      temperatureText: '12℃',
      weatherIcon: '❄️',
      items: [
        {
          timeString: '07:30 专车',
          category: 'transport',
          badgeText: 'VIP直通车',
          title: '丽江古城 ➔ 玉龙雪山大索道',
          description: '专属进山绿色通道，含防寒服与医用氧气瓶保障',
          highlightReason: '判官已提前锁定周四早场大索道名额'
        },
        {
          timeString: '13:30 漫步',
          category: 'attraction',
          badgeText: '自然奇观',
          title: '蓝月谷 (白水台与镜潭湖)',
          description: '阳光折射下的蓝绿色钙化池，如流动的翡翠',
          metricsText: '建议游玩时长 2.5 小时 · 无需电瓶车步行最惬意'
        }
      ]
    },
    {
      dayIndex: 5,
      dayLabel: 'D5 归途返程',
      cityTheme: '手信采买·从容还乡',
      weatherText: '晴',
      temperatureText: '21℃',
      weatherIcon: '☀️',
      items: [
        {
          timeString: '10:00 采购',
          category: 'meal',
          badgeText: '在地风物',
          title: '鲜花饼工坊 & 云南小粒咖啡体验店',
          description: '现烤玫瑰鲜花饼与保山铁皮卡咖啡豆，直邮到家',
          highlightReason: '判官筛选认证: 严选明码标价非景区专营店'
        },
        {
          timeString: '15:20 返程',
          category: 'transport',
          badgeText: '直飞航班',
          title: '丽江三义机场 ➔ 成都天府',
          description: '圆满结束云南休闲纯玩五日慢调之旅',
          highlightReason: '预留充裕候机时间，准点返程'
        }
      ]
    }
  ]
};

export const defaultChatMessages: ChatMessageItem[] = [
  {
    id: 'msg_user_001',
    sender: 'user',
    content: '成都出发，去云南 5 天 4 晚，两个人，预算 8000，休闲不累，不套路购物，要吃当地特色。',
    createdAt: '10:48'
  },
  {
    id: 'msg_agent_001',
    sender: 'agent',
    semanticTags: ['智能语义解析 (2人/5天/¥8000)'],
    toolTags: [
      '昆明/大理天气API 21°C晴',
      '12306车次实时比价',
      '携程高分洱海海景客栈',
      '行程判官: 0硬伤路线最优'
    ],
    content: '主人，奴仆已全身心为您查、算、排完毕！已为您定制「云南5天4晚·慢调风花雪月」路线，全程不走回头路、无强制购物，并锁定了地道野生菌与白族风味：',
    showItineraryLink: true,
    createdAt: '10:48'
  }
];

export const defaultExploreMapPins: ExploreMapPin[] = [
  {
    id: 'pin_1',
    title: '高山河谷首次深岩',
    cityName: '漫目',
    topPercent: 24,
    leftPercent: 54
  },
  {
    id: 'pin_2',
    title: '竹梅茶系煎白绿日常',
    cityName: '成都',
    topPercent: 38,
    leftPercent: 62
  },
  {
    id: 'pin_3',
    title: '三江汇流对比动望大佛',
    cityName: '乐山',
    topPercent: 64,
    leftPercent: 66
  }
];

export const defaultExploreCollections: ExploreCollectionItem[] = [
  {
    id: 'col_1',
    title: '全国老式糕点地图',
    detailMeta: '20 地点 · 98 订阅'
  },
  {
    id: 'col_2',
    title: '自驾出发！登顶登大斜路',
    detailMeta: '15 路线 · 340 订阅'
  }
];

export const defaultAdminMetrics: AdminMetricsData = {
  todayPlanCount: 1482,
  conversionRatePercent: 38.6,
  conversionRateDiffPercent: 4.2,
  personas: [
    {
      id: 'persona_1',
      title: '休闲奢享风 (客单价>8k)',
      description: '优先推荐高评分设计师客栈，规避零售购物',
      statusText: '使用中'
    },
    {
      id: 'persona_2',
      title: '特战青年/高性价比风',
      description: '优化红眼动车、青年旅社、高强度打卡',
      statusText: '使用中'
    }
  ],
  routes: [
    {
      id: 'route_1',
      title: '川西大环线 7天6晚 (自驾/包车)',
      description: '包含九寨+黄龙+若尔盖连线 | 库存: 充足',
      statusText: '在售'
    },
    {
      id: 'route_2',
      title: '大理丽江5天4晚私家团',
      description: '匹配同行预算 ¥2,500~¥4,500 | 自动排单',
      statusText: '在售'
    }
  ]
};
