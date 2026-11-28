import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/** Global provider of {@link CryptoService}. */
@Global()
@Module({ providers: [CryptoService], exports: [CryptoService] })
export class CryptoModule {}
