import { Module } from '@nestjs/common';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

/** First-launch bootstrap of the default admin. */
@Module({ controllers: [SetupController], providers: [SetupService] })
export class SetupModule {}
