import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global provider of {@link PrismaService}. */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
