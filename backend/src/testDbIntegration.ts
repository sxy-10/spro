import { pool, checkDatabaseConnection } from './db/connection.js';
import {
  saveItineraryRecord,
  getItineraryByNo,
  saveItineraryOptimization,
  saveExportRecord,
  getProductsFromDb,
  insertProductToDb,
  getAnalyticsFromDb
} from './db/repository.js';
import { TravelPlannerAgent } from './agent/planner.js';

async function runSelfCheck() {
  console.log('🧪 开始进行全链路数据库持久化自检...');

  // 1. 测试数据库连通性
  const isHealthy = await checkDatabaseConnection();
  if (!isHealthy) {
    throw new Error('数据库连通性检查未通过');
  }

  // 2. 测试后台产品列表查询（验证 02_seed.sql 数据是否就绪）
  const products = await getProductsFromDb();
  console.log(`📦 成功从 travel_product 表加载到 ${products.length} 个产品`);
  if (products.length === 0) {
    throw new Error('未查到 travel_product 种子数据');
  }

  // 3. 测试后台新增产品持久化
  const newProduct = await insertProductToDb({
    title: '云南腾冲银杏村4日温泉养生游',
    destination: '云南/腾冲',
    defaultDays: 4,
    styleTag: '温泉养生',
    basePriceRmb: 2680
  });
  console.log(`✅ 成功持久化新增线路产品: ${newProduct.title} (ID: ${newProduct.productId})`);

  // 4. 测试智能体规划与完整行程持久化入库
  const planner = new TravelPlannerAgent();
  const prompt = '带爸妈去大理和丽江4天，预算5000，节奏慢一点，不要购物';
  const preference = await planner.extractPreferenceFromText(prompt);
  const plan = await planner.generatePlan(preference);

  console.log('📝 正在将生成的行程单写入数据库 (itinerary / day_plan / schedule_item / ...)...');
  const saveResult = await saveItineraryRecord({
    itinerary: plan,
    preference,
    userPrompt: prompt,
    userId: 2
  });
  console.log(`✅ 方案持久化成功! 业务编号(ULID): ${saveResult.itineraryNo}, 数据库ID: ${saveResult.itineraryId}`);

  // 5. 测试按编号读取持久化行程
  const fetchedPlan = await getItineraryByNo(saveResult.itineraryNo);
  if (!fetchedPlan) {
    throw new Error(`无法从数据库读取刚刚持久化的行程: ${saveResult.itineraryNo}`);
  }
  console.log(`📖 成功从数据库回读行程: 「${fetchedPlan.planTitle}」, 状态: ${fetchedPlan.status}`);

  // 6. 测试多轮调整与优化版本留痕
  console.log('🔄 正在测试多轮调整与版本快照持久化...');
  const optimizedPlan = await planner.optimizeItinerary(plan, '第二天下午增加茶马古道骑马体验');
  const newVersion = await saveItineraryOptimization(
    saveResult.itineraryNo,
    optimizedPlan,
    '第二天下午增加茶马古道骑马体验'
  );
  console.log(`✅ 行程优化版本持久化成功! 新版本号: v${newVersion}`);

  // 7. 测试导出记录持久化
  console.log('📤 正在测试导出记录写入 export_record 表...');
  const exportId = await saveExportRecord(
    saveResult.itineraryNo,
    'WECHAT_LONG_TEXT',
    '# 微信长文导出测试内容'
  );
  console.log(`✅ 导出记录持久化成功! 记录ID: ${exportId}`);

  // 8. 测试统计分析真实聚合
  const analytics = await getAnalyticsFromDb();
  console.log('📊 成功从数据库各表聚合统计数据:');
  console.log(`   - 总咨询数: ${analytics.totalConsultations}`);
  console.log(`   - 行程方案数: ${analytics.plansGeneratedCount}`);
  console.log(`   - 转化率: ${analytics.conversionRatePercent}%`);
  console.log(`   - 热门目的地: ${analytics.popularDestinations.map(d => `${d.city}(${d.count})`).join(', ')}`);

  console.log('\n🎉 所有数据持久化测试全部通过！数据已完好写入 MySQL 数据库 travel_agent_db！');
  await pool.end();
}

runSelfCheck().catch((err) => {
  console.error('❌ 自检失败:', err);
  process.exit(1);
});
