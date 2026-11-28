-- CreateTable
CREATE TABLE "ReviewedPullRequest" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "waitHours" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ReviewedPullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewedPullRequest_date_idx" ON "ReviewedPullRequest"("date");

-- CreateIndex
CREATE INDEX "ReviewedPullRequest_memberId_idx" ON "ReviewedPullRequest"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewedPullRequest_connectionId_key_key" ON "ReviewedPullRequest"("connectionId", "key");

-- AddForeignKey
ALTER TABLE "ReviewedPullRequest" ADD CONSTRAINT "ReviewedPullRequest_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewedPullRequest" ADD CONSTRAINT "ReviewedPullRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
