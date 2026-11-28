-- Completed work items and everyone who held them, so team totals count each item once.
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "storyPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cycleTimeHours" DOUBLE PRECISION,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkItemContributor" (
    "workItemId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "WorkItemContributor_pkey" PRIMARY KEY ("workItemId","memberId")
);

CREATE UNIQUE INDEX "WorkItem_connectionId_key_key" ON "WorkItem"("connectionId", "key");
CREATE INDEX "WorkItem_date_idx" ON "WorkItem"("date");
CREATE INDEX "WorkItemContributor_memberId_idx" ON "WorkItemContributor"("memberId");

ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkItemContributor" ADD CONSTRAINT "WorkItemContributor_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkItemContributor" ADD CONSTRAINT "WorkItemContributor_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
