-- Cadence supports Azure DevOps and Jira only. Connections from removed providers
-- (and their identities, metrics, services and runs, via ON DELETE CASCADE) are dropped.
DELETE FROM "IntegrationConnection" WHERE "provider"::text IN ('GITHUB', 'GITLAB', 'LINEAR');

ALTER TYPE "IntegrationProvider" RENAME TO "IntegrationProvider_old";
CREATE TYPE "IntegrationProvider" AS ENUM ('JIRA', 'AZURE_DEVOPS');
ALTER TABLE "IntegrationConnection"
  ALTER COLUMN "provider" TYPE "IntegrationProvider" USING ("provider"::text::"IntegrationProvider");
DROP TYPE "IntegrationProvider_old";
