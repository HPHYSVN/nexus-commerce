import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173', credentials: true });
  const productUrl = process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:8001';
  app.use(
    '/api/products',
    createProxyMiddleware({
      target: productUrl,
      changeOrigin: true,
      pathRewrite: (path: string) => {
        const [pathname, query] = path.split('?');
        return `/products${pathname === '/' ? '' : pathname}${query ? `?${query}` : ''}`;
      },
      on: {
        error: (_err, _req, res: any) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Product service unavailable' } }));
        },
      },
    }),
  );
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
