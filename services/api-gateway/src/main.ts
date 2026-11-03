import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { verifyToken } from './jwt.util';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET env must be set (>= 32 chars) — refusing to start with a fallback secret');
}
const SECRET: string = JWT_SECRET;

const err = (res: any, status: number, code: string, message: string) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
};

const PUBLIC: Array<[string, RegExp]> = [
  ['POST', /^\/api\/auth\/(register|login|refresh|google|verify-email|forgot-password|reset-password)$/],
  ['GET', /^\/api\/products(\/.*)?$/],
  ['GET', /^\/api\/categories$/],
];

function isPublic(method: string, url: string) {
  const path = url.split('?')[0];
  return PUBLIC.some(([m, re]) => m === method && re.test(path));
}

function authGuard(req: any, res: any, next: () => void) {
  if (req.path === '/health' || isPublic(req.method, req.originalUrl)) return next();
  const header: string = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return err(res, 401, 'UNAUTHORIZED', 'Missing bearer token');
  try {
    const claims = verifyToken(header.slice(7), SECRET);
    req.user = claims;
    const adminWrite =
      (/^\/api\/products/.test(req.path) && ['POST', 'PUT', 'DELETE'].includes(req.method)) ||
      (/^\/api\/inventory/.test(req.path) && req.method === 'PUT') ||
      /^\/api\/admin/.test(req.path);
    if (adminWrite && claims.role !== 'ADMIN') return err(res, 403, 'FORBIDDEN', 'Admin role required');
    return next();
  } catch {
    return err(res, 401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}

function correlation(req: any, res: any, next: () => void) {
  req.headers['x-correlation-id'] = req.headers['x-correlation-id'] ?? randomUUID();
  res.setHeader('x-correlation-id', req.headers['x-correlation-id']);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  next();
}

function rewrite(prefix: string) {
  return (path: string) => {
    const [pathname, query] = path.split('?');
    return `${prefix}${pathname === '/' ? '' : pathname}${query ? `?${query}` : ''}`;
  };
}

function proxy(mount: string, target: string | undefined, prefix: string, app: any) {
  if (!target) return;
  app.use(
    mount,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: rewrite(prefix),
      on: {
        proxyReq: (proxyReq: any, req: any) => {
          proxyReq.setHeader('x-correlation-id', req.headers['x-correlation-id'] ?? '');
          if (req.user) {
            proxyReq.setHeader('x-user-id', req.user.sub);
            proxyReq.setHeader('x-user-role', req.user.role ?? '');
          }
        },
        error: (_e, _req, res: any) => err(res, 502, 'UPSTREAM_UNAVAILABLE', `${mount} service unavailable`),
      },
    }),
  );
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173', credentials: true });
  const http = app.getHttpAdapter().getInstance();
  http.use(correlation);
  http.use('/api', (req: any, res: any, next: () => void) => {
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > 65_536) return err(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 64KB');
    return next();
  });
  http.use('/api', rateLimit({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_GLOBAL ?? 1000), standardHeaders: true, legacyHeaders: false }));
  http.use('/api/auth', rateLimit({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_AUTH ?? 30), standardHeaders: true, legacyHeaders: false }));
  http.use(authGuard);
  proxy('/api/auth', process.env.IDENTITY_SERVICE_URL ?? 'http://localhost:8081', '/auth', http);
  proxy('/api/products', process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:8001', '/products', http);
  proxy('/api/categories', process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:8001', '/categories', http);
  proxy('/api/cart', process.env.CART_SERVICE_URL ?? 'http://localhost:8002', '/cart', http);
  proxy('/api/inventory', process.env.INVENTORY_SERVICE_URL ?? 'http://localhost:8082', '/stock', http);
  proxy('/api/orders', process.env.ORDER_SERVICE_URL ?? 'http://localhost:8083', '/orders', http);
  proxy('/api/admin', process.env.ORDER_SERVICE_URL ?? 'http://localhost:8083', '/admin', http);
  proxy('/api/notifications', process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:8003', '/notifications', http);
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
