import {
  DetailedItinerary,
  ChatMessageItem,
  ExploreMapPin,
  ExploreCollectionItem,
  ProfileFavoriteItem,
  ProfileSubscriptionItem,
  ProfileFootprintItem,
  ProfileCollectionPassItem,
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

export const defaultProfileFavorites: ProfileFavoriteItem[] = [
  {
    id: 'fav_1',
    title: '科隆1日游不走回头路',
    category: '路线',
    description: '0回头路单向闭环，9大莱茵名胜串联，火车站出发即达大教堂',
    badgeText: '判官认证 0折返',
    planPrompt: '我想规划收藏夹里的「科隆1日游不走回头路」，请按0回头路生成完整行程'
  },
  {
    id: 'fav_2',
    title: '云南5天4晚慢调风花雪月',
    category: '路线',
    description: '昆明·大理·丽江纯玩无购物，入住洱海一线海景客栈',
    badgeText: '慢调纯玩',
    planPrompt: '规划我的收藏路线「云南5天4晚慢调风花雪月」，2人预算8000，吃特色'
  },
  {
    id: 'fav_3',
    title: '川西贡嘎雪山4日自驾环线',
    category: '路线',
    description: '格底拉姆天空之城落日与斯丁措雪山倒影，严选避堵路线',
    badgeText: '摄影胜地',
    planPrompt: '请帮我规划收藏夹里的「川西贡嘎雪山4日自驾环线」'
  },
  {
    id: 'fav_4',
    title: '全国老式糕点地图',
    category: '美食',
    description: '20个老字号非遗鲜花饼与苏式酥皮点心寻味打卡指南',
    badgeText: '非遗老饕',
    planPrompt: '根据「全国老式糕点地图」为我规划一次城市美食寻味路线'
  },
  {
    id: 'fav_5',
    title: '段公子·野生菌铜锅土鸡煲',
    category: '美食',
    description: '大理古城排队王，深山鲜菌慢熬土鸡汤底，温补不上火',
    badgeText: '地道滇味',
    planPrompt: '我想去大理吃段公子野生菌铜锅土鸡煲，帮我顺路排入大理当天的晚餐行程'
  },
  {
    id: 'fav_6',
    title: '大理双廊澜庭海景客栈',
    category: '景点',
    description: '亲水临湖露台客房，享落日海景双人下午茶',
    badgeText: '设计师宿',
    planPrompt: '帮我规划以大理双廊澜庭海景客栈为下榻点的洱海慢调度假日程'
  },
  {
    id: 'fav_7',
    title: '洱海生态廊道骑行',
    category: '景点',
    description: '双廊至磻溪S湾全景观光，顺风顺光无机动车干扰',
    badgeText: '生态绿道',
    planPrompt: '请帮我规划洱海生态廊道骑行及周边一日慢调漫游'
  },
  {
    id: 'fav_8',
    title: '百年酒馆 Früh am Dom 烤猪肘',
    category: '美食',
    description: '大教堂旁现烤酥香德国大猪肘配酸菜土豆泥与冷萃啤酒',
    badgeText: '德式风味',
    planPrompt: '我想去科隆百年酒馆 Früh am Dom 吃猪肘，帮我排进莱茵河行程'
  }
];

export const defaultProfileSubscriptions: ProfileSubscriptionItem[] = [
  {
    id: 'sub_1',
    title: '🛡️ 行程判官·避坑预警雷达',
    description: '玉龙雪山索道例检停运、热门景区限流管控及气象突变每日预警播报',
    frequency: '每日 08:00 播报',
    enabled: true,
    checkPrompt: '查询行程判官避坑雷达今日最新预警与景点突发状况'
  },
  {
    id: 'sub_2',
    title: '📉 实时票价与机票动车降价监控',
    description: '西南热门航线与成都-昆明高铁票价波动监控 (当前已降 ¥120)',
    frequency: '降价即时提醒',
    enabled: true,
    checkPrompt: '查看成都到大理昆明的最新降价动态与12306车次优惠'
  },
  {
    id: 'sub_3',
    title: '🍲 季节地道风物上市周报',
    description: '云南野生菌季首发、川西松茸采摘期与沿线特色小吃鲜货上市',
    frequency: '每周五 10:00 播报',
    enabled: false,
    checkPrompt: '查看云南野生菌季与时令美食最新上市周报'
  },
  {
    id: 'sub_4',
    title: '🚗 川西滇藏自驾路况气象',
    description: '折多山降雪结冰、318川藏线管制施工及沿线补给站动态',
    frequency: '高频路况更新',
    enabled: false,
    checkPrompt: '查询川西318国道最新路况与气象通行条件'
  }
];

export const defaultProfileFootprints: ProfileFootprintItem[] = [
  { id: 'fp_1', cityName: '成都', provinceName: '四川', yearString: '2026', countryCode: '🇨🇳', description: '主居地 · 打卡青羊宫茶肆、锦里与宽窄巷子' },
  { id: 'fp_2', cityName: '大理', provinceName: '云南', yearString: '2026', countryCode: '🇨🇳', description: '洱海漫游 · 磻溪S湾与苍山双廊生态廊道骑行' },
  { id: 'fp_3', cityName: '丽江', provinceName: '云南', yearString: '2026', countryCode: '🇨🇳', description: '雪山古城 · 蓝月谷与木府忠义市场老饕漫步' },
  { id: 'fp_4', cityName: '昆明', provinceName: '云南', yearString: '2026', countryCode: '🇨🇳', description: '春城老街 · 翠湖海鸥红嘴鸥与老字号过桥米线' },
  { id: 'fp_5', cityName: '乐山', provinceName: '四川', yearString: '2025', countryCode: '🇨🇳', description: '三江汇流 · 乐山大佛凌云寺与地道钵钵鸡' },
  { id: 'fp_6', cityName: '科隆', provinceName: '北威州', yearString: '2025', countryCode: '🇩🇪', description: '哥特莱茵 · 0回头路大教堂登顶与巧克力博物馆' }
];

export const defaultProfileCollectionPasses: ProfileCollectionPassItem[] = [
  { id: 'cp_1', title: '科隆大教堂登顶纪念票', passType: '景点纪念票根', issueDate: '2025-10-18', serialNumber: 'KD-2025-08129', statusText: '已核验入场', highlight: '登顶533级台阶俯瞰莱茵全景' },
  { id: 'cp_2', title: '洱海生态廊道骑行限定徽章', passType: '成就电子徽章', issueDate: '2026-03-22', serialNumber: 'EH-RIDE-00921', statusText: '已点亮徽章', highlight: '环洱海生态绿道20km纯慢调认证' },
  { id: 'cp_3', title: '「行程判官」0硬伤认证证书', passType: '行程认证文件', issueDate: '2026-04-05', serialNumber: 'JG-CERT-77319', statusText: '已认证生效', highlight: '云南5天4晚0折返0购物合规评级' }
];

export const cologne1DayItinerary: DetailedItinerary = {
  planId: 'plan_cologne_001',
  title: '科隆1日游不走回头路',
  subTagText: '德国莱茵名城 · 经典城市漫步 · 0回头路 · 9大精选地点',
  routeText: '科隆中央火车站 ➔ 大教堂 ➔ 霍亨索伦桥 ➔ 莱茵公园 ➔ 巧克力博物馆',
  durationSummary: '1天0晚',
  budgetSummaryRmb: 850,
  judgeOptimalityScore: '0回头路',
  judgeCertification: {
    statusTitle: '行程判官认证：无硬伤',
    detailMessage: '动线为严格单向闭环，无折返路段，9个地点打卡时段与步行体力负荷全部校核通过。',
    verifiedBadgeText: '已认证 判官'
  },
  days: [
    {
      dayIndex: 1,
      dayLabel: 'D1 科隆全景',
      cityTheme: '哥特风华·莱茵漫步·9大经典地标',
      weatherText: '微风晴朗',
      temperatureText: '18℃',
      weatherIcon: '🌤️',
      items: [
        {
          timeString: '08:30 交通',
          category: 'transport',
          badgeText: '核心始发',
          title: '地点1：科隆中央火车站 (Köln Hbf)',
          description: '出站即达大教堂广场，提供便捷行李寄存，动线始发点',
          highlightReason: '判官测算: 避开早高峰出站人潮，步行50米直面大教堂'
        },
        {
          timeString: '09:00 景点',
          category: 'attraction',
          badgeText: '世界遗产',
          title: '地点2：科隆大教堂 (Kölner Dom)',
          description: '登临南塔533级台阶俯瞰莱茵河，欣赏哥特式彩色玻璃花窗',
          highlightReason: '上午晨光顺光照射西侧立面，摄影最佳时机'
        },
        {
          timeString: '10:45 人文',
          category: 'attraction',
          badgeText: '罗马遗迹',
          title: '地点3：罗马-日耳曼博物馆与路德维希美术馆',
          description: '馆藏毕加索经典画作与古罗马狄奥尼索斯马赛克地砖',
          highlightReason: '紧邻大教堂东侧，无缝顺路衔接'
        },
        {
          timeString: '11:45 漫游',
          category: 'attraction',
          badgeText: '浪漫地标',
          title: '地点4：霍亨索伦桥 (Hohenzollernbrücke)',
          description: '密密麻麻的五彩爱情锁，步行横跨莱茵河，遥望双塔全景',
          highlightReason: '桥上远眺对岸天际线，步行过江不走折返路'
        },
        {
          timeString: '12:30 午餐',
          category: 'meal',
          badgeText: '德式风味',
          title: '地点5：百年酒馆 Früh am Dom 烤猪肘与 Kölsch 啤酒',
          description: '脆皮酥香德国大猪肘配酸菜土豆泥，品味本地清爽考尔施特饮',
          metricsText: '人均 €25 (约¥195) · 招牌: 脆皮猪肘、鲜酿生啤'
        },
        {
          timeString: '14:00 漫步',
          category: 'attraction',
          badgeText: '风情老城',
          title: '地点6：大圣马丁教堂与鱼市场彩色房屋',
          description: '穿梭鹅卵石老街，在彩虹色沿河小屋前留下复古明信片照',
          highlightReason: '由桥侧自然缓行而下，避开机动车主干道'
        },
        {
          timeString: '15:30 探寻',
          category: 'attraction',
          badgeText: '香水鼻祖',
          title: '地点7：老集市广场 (Alter Markt) 与法里纳香水博物馆',
          description: '探访世界上第一瓶古龙水（Eau de Cologne）诞生地',
          highlightReason: '法里纳故居地处老城心脏，沿途咖啡馆小憩'
        },
        {
          timeString: '17:00 体验',
          category: 'attraction',
          badgeText: '甜蜜互动',
          title: '地点8：Imhoff 巧克力博物馆 (Schokoladenmuseum)',
          description: '形如莱茵河上的一艘轮船，品尝现蘸热巧克力的黄金可可喷泉',
          highlightReason: '设有临江观景咖啡座，恰逢午后落日余晖'
        },
        {
          timeString: '19:00 晚餐与归程',
          category: 'meal',
          badgeText: '夜景收官',
          title: '地点9：莱茵滨河观景餐厅 & 游船码头',
          description: '伴随大教堂金色射灯倒影享用晚餐，步行5分钟轻松返回中央车站',
          highlightReason: '完美单向闭环，全天0折返，完成9大打卡点'
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
    leftPercent: 54,
    category: 'nature',
    description: '深入川西峡谷秘境，奇绝地貌与原生态徒步胜地',
    tags: ['地质奇观', '小众徒步', '0回头路'],
    region: '四川'
  },
  {
    id: 'pin_2',
    title: '竹梅茶系煎白绿日常',
    cityName: '成都',
    topPercent: 38,
    leftPercent: 62,
    category: 'culture',
    description: '青羊宫旁的幽静茶肆，体验慢调川西盖碗茶与竹影市井',
    tags: ['老茶馆', '川派慢生活', '市井烟火'],
    region: '四川'
  },
  {
    id: 'pin_3',
    title: '三江汇流对比动望大佛',
    cityName: '乐山',
    topPercent: 64,
    leftPercent: 66,
    category: 'culture',
    description: '岷江、青衣江、大渡河三江汇聚，千年石刻大佛临江端坐',
    tags: ['世界遗产', '地道钵钵鸡', '水运码头'],
    region: '四川'
  },
  {
    id: 'pin_4',
    title: '洱海生态廊道落日骑行',
    cityName: '大理',
    topPercent: 46,
    leftPercent: 38,
    category: 'nature',
    description: '双廊至磻溪S湾全景观光，顺风顺光无机动车干扰',
    tags: ['海景骑行', '落日机位', '避开人流'],
    region: '云南'
  },
  {
    id: 'pin_5',
    title: '科隆大教堂登顶俯瞰',
    cityName: '科隆',
    topPercent: 28,
    leftPercent: 78,
    category: 'city',
    description: '双塔直插云霄，莱茵河全景倒影与彩色玻璃花窗',
    tags: ['哥特地标', '0折返闭环', '精酿啤酒'],
    region: '国际'
  }
];

export const defaultExploreCollections: ExploreCollectionItem[] = [
  {
    id: 'col_1',
    title: '全国老式糕点地图',
    detailMeta: '20 地点 · 98 订阅',
    description: '打卡各地百年老字号酥饼、鲜花饼与糯米糕点，舌尖上的非遗回甘',
    tags: ['非遗老字号', '糕点手信', '地道风物']
  },
  {
    id: 'col_2',
    title: '自驾出发！登顶登大斜路',
    detailMeta: '15 路线 · 340 订阅',
    description: '盘山公路越野自驾与高山牧场穿行，判官严选安全弯道补给点',
    tags: ['自驾公路', '山野弯道', '观景台']
  },
  {
    id: 'col_3',
    title: '慢调双城·山水咖啡巡礼',
    detailMeta: '12 路线 · 210 订阅',
    description: '依山傍水的设计师咖啡馆与云南小粒咖啡庄园，静享微风午后',
    tags: ['设计师空间', '咖啡庄园', '发呆慢游']
  },
  {
    id: 'col_4',
    title: '市井烟火·本地老饕夜市精选',
    detailMeta: '18 地点 · 165 订阅',
    description: '避开商业化游客街，直达本地居民下班聚集的镬气排档',
    tags: ['本地老饕', '深夜食堂', '无套路']
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
