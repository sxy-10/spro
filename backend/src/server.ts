import { app } from './app.js';
import { secret } from './api/core.js';
import { startStockExpiryJob } from './api/stock.js';
secret();
const server = app.listen(Number(process.env.PORT) || 3001, () => console.log('Travel Agent API started'));
server.requestTimeout = 30000;
server.headersTimeout = 15000;
const stopStockExpiry = startStockExpiryJob();
server.on('close',stopStockExpiry);
