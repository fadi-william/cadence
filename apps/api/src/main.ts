import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

/** Starts the API on `PORT` (default 3000). */
async function bootstrap() {
  // rawBody: webhook signatures are computed over the exact bytes received.
  const app = configureApp(await NestFactory.create(AppModule, { rawBody: true }));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Cadence API listening on http://localhost:${port}/api`, 'Bootstrap');
}
void bootstrap();
