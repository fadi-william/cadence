import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** Management of sign-in accounts below the admin. */
@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
