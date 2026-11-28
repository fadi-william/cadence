import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

/** Member CRUD and identity linking. */
@Module({ controllers: [MembersController], providers: [MembersService] })
export class MembersModule {}
