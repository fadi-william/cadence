import { Global, Module } from '@nestjs/common';
import { AccessScopeService } from './access-scope.service';
import { OrgController } from './org.controller';

/** Organisation tree endpoint and the global {@link AccessScopeService}. */
@Global()
@Module({ controllers: [OrgController], providers: [AccessScopeService], exports: [AccessScopeService] })
export class OrgModule {}
