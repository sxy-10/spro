import { Kafka, type Consumer, type Producer } from 'kafkajs';

const brokers = (process.env.KAFKA_BROKERS ?? '127.0.0.1:9092')
  .split(',')
  .map((broker) => broker.trim())
  .filter(Boolean);

if (brokers.length === 0) {
  throw new Error('KAFKA_BROKERS must contain at least one broker');
}

export const SECKILL_TOPIC = 'seckill';
export const SECKILL_RETRY_TOPIC = 'seckill.retry';
export const SECKILL_DLT_TOPIC = 'seckill.dlt';
export const RECOMMENDATION_EVENTS_TOPIC = 'rec.events';
export const SECKILL_GROUP = process.env.SECKILL_GROUP ?? 'seckill-worker';

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID ?? 'travel-agent-node',
  brokers,
  connectionTimeout: Number(process.env.KAFKA_CONNECT_TIMEOUT_MS ?? 3000),
  requestTimeout: Number(process.env.KAFKA_REQUEST_TIMEOUT_MS ?? 10000),
  retry: { retries: 3, initialRetryTime: 250, maxRetryTime: 2000 }
});

let producer: Producer | null = null;
let producerConnection: Promise<Producer> | null = null;

export async function getKafkaProducer(): Promise<Producer> {
  if (producer) return producer;
  if (!producerConnection) {
    producerConnection = (async () => {
      const instance = kafka.producer({
        idempotent: true,
        maxInFlightRequests: 5,
        allowAutoTopicCreation: false
      });
      await instance.connect();
      producer = instance;
      return instance;
    })().catch((error: unknown) => {
      producerConnection = null;
      throw error;
    });
  }
  return producerConnection;
}

export async function createKafkaConsumer(groupId = SECKILL_GROUP): Promise<Consumer> {
  const consumer = kafka.consumer({ groupId, allowAutoTopicCreation: false });
  await consumer.connect();
  return consumer;
}

export async function publishKafka(
  topic: string,
  messages: Array<{ key: string; value: string; headers?: Record<string, string> }>
): Promise<void> {
  const instance = await getKafkaProducer();
  await instance.send({
    topic,
    acks: -1,
    timeout: Number(process.env.KAFKA_REQUEST_TIMEOUT_MS ?? 10000),
    messages
  });
}

export async function disconnectKafkaProducer(): Promise<void> {
  const instance = producer;
  producer = null;
  producerConnection = null;
  if (instance) await instance.disconnect();
}

export function createKafkaAdmin() {
  return kafka.admin();
}
