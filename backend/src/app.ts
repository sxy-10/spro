import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { randomUUID } from 'node:crypto';
import { api } from './api/router.js';
import { ApiError, errors } from './api/core.js';

export const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.locals.traceId = randomUUID();
  res.setHeader('X-Trace-Id', res.locals.traceId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!req.secure) {
      const origin = process.env.PUBLIC_API_ORIGIN;
      if (!origin?.startsWith('https://')) { next(new ApiError(503, 50001, '服务暂不可用')); return; }
      res.redirect(308, `${origin}${req.originalUrl}`); return;
    }
  }
  next();
});
app.use(cors({ origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','), exposedHeaders: ['X-Trace-Id','Retry-After'] }));
app.use(compression());
app.use(express.json({ limit: '64kb', strict: true }));
app.use((req, _res, next) => {
  if (['POST','PUT','PATCH'].includes(req.method) && !req.is('application/json')) {
    next(new ApiError(400,10001,'请求必须使用 application/json')); return;
  }
  if (Object.keys(req.query).some(k => /token|api[_-]?key/i.test(k))) {
    next(new ApiError(400,10001,'认证凭据只能放在请求头')); return;
  }
  next();
});
app.use('/v1', api);
app.use((_req, _res, next) => next(new ApiError(404,20012,'接口不存在')));
app.use(errors);
