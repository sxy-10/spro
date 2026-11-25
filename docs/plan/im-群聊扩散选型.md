# IM 群聊扩散选型（与秒杀 Kafka 分流）

**决定：秒杀和推荐埋点使用 Kafka；IM `im:notify` 保持 Redis Stream，不迁移。**

IM 离线通知消费者依赖 Redis 在线状态（`im:online:*`）和离线计数（`im:offline:*`），消息轻量、无削峰与长时间重放需求。迁移 Kafka 后仍需回 Redis 查询/计数，多一跳却没有业务收益；Redis 不可用时，原有 Stream 消费链路可以安静降级。秒杀则需要持久重放、削峰和 MySQL 落单，因此单独使用 Kafka。

Kafka topic：`seckill`、`seckill.retry`、`seckill.dlt`、`rec.events`。不要将 `im:notify` 合并到其中任何一个 topic。
