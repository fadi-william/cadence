import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';

/** Global provider of {@link MailerService}. */
@Global()
@Module({ providers: [MailerService], exports: [MailerService] })
export class MailModule {}
