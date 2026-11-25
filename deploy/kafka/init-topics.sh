#!/usr/bin/env bash
set -euo pipefail

BOOTSTRAP_SERVERS="${KAFKA_BOOTSTRAP_SERVERS:-kafka:29092}"
KAFKA_TOPICS="/opt/kafka/bin/kafka-topics.sh"

for attempt in $(seq 1 30); do
  if "$KAFKA_TOPICS" --bootstrap-server "$BOOTSTRAP_SERVERS" --list >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "Kafka did not become ready at $BOOTSTRAP_SERVERS" >&2
    exit 1
  fi
  sleep 2
done

"$KAFKA_TOPICS" --bootstrap-server "$BOOTSTRAP_SERVERS" --create --if-not-exists \
  --topic seckill --partitions 4 --replication-factor 1 --config retention.ms=604800000
"$KAFKA_TOPICS" --bootstrap-server "$BOOTSTRAP_SERVERS" --create --if-not-exists \
  --topic seckill.retry --partitions 4 --replication-factor 1 --config retention.ms=604800000
"$KAFKA_TOPICS" --bootstrap-server "$BOOTSTRAP_SERVERS" --create --if-not-exists \
  --topic seckill.dlt --partitions 4 --replication-factor 1 --config retention.ms=2592000000
"$KAFKA_TOPICS" --bootstrap-server "$BOOTSTRAP_SERVERS" --create --if-not-exists \
  --topic rec.events --partitions 4 --replication-factor 1 --config retention.ms=604800000

echo "Kafka topics ready: seckill, seckill.retry, seckill.dlt, rec.events"
