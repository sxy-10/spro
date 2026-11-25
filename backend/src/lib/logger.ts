import { resolve } from 'node:path';
import pino from 'pino';

export const nodeLogPath = resolve(process.cwd(), process.env.NODE_LOG_FILE ?? 'logs/node.log');
const fileDestination = pino.destination({ dest: nodeLogPath, mkdir: true, sync: true });

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime
}, pino.multistream([
  { stream: process.stdout },
  { stream: fileDestination }
]));
