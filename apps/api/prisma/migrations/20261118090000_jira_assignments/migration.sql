-- Jira assignments: periods one person held a work item, with hold time and rework.
ALTER TABLE "DailyMetric" ADD COLUMN "assignmentsCompleted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "assignmentsHandedOver" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "assignmentsReworked" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "holdHoursSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "holdSamples" INTEGER NOT NULL DEFAULT 0;
