import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/** Activity metric read endpoints (summaries, roll-ups, member profiles). */
@Module({ controllers: [MetricsController], providers: [MetricsService] })
export class MetricsModule {}
