-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('WORK_TRACKING', 'SOURCE_CONTROL', 'DEPLOYMENTS');

-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN "features" "IntegrationKind"[];

-- Existing connections keep exactly what they synced before this change. Work tracking for Azure DevOps
-- (Azure Boards) is new, so it stays off until an admin turns it on.
UPDATE "IntegrationConnection" SET "features" = ARRAY['WORK_TRACKING']::"IntegrationKind"[] WHERE "provider" = 'JIRA';
UPDATE "IntegrationConnection" SET "features" = ARRAY['SOURCE_CONTROL', 'DEPLOYMENTS']::"IntegrationKind"[] WHERE "provider" = 'AZURE_DEVOPS';
