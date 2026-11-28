import { Module } from '@nestjs/common';
import { DoraController } from './dora.controller';
import { DoraService } from './dora.service';

/** DORA summary and delivery-service ownership. */
@Module({ controllers: [DoraController], providers: [DoraService] })
export class DoraModule {}
