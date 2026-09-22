-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'PLANNING', 'RUNNING', 'PAUSED_CAPTCHA', 'PAUSED_OTP', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunEventType" AS ENUM ('LOG', 'STEP_START', 'STEP_COMPLETE', 'STEP_FAILED', 'CHECKLIST_UPDATE', 'COUNTER_UPDATE', 'PAUSE', 'RESUMED', 'ERROR');

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "instructionsText" TEXT NOT NULL,
    "fieldList" JSONB NOT NULL,
    "planJson" JSONB,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "currentStepLabel" TEXT,
    "progressCurrent" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "extractedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "type" "RunEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedListing" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "listingUrl" TEXT NOT NULL,
    "listingId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractedListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsvFile" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsvFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Run_status_idx" ON "Run"("status");

-- CreateIndex
CREATE INDEX "Run_createdAt_idx" ON "Run"("createdAt");

-- CreateIndex
CREATE INDEX "RunEvent_runId_createdAt_idx" ON "RunEvent"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "ExtractedListing_runId_createdAt_idx" ON "ExtractedListing"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedListing_runId_dedupeKey_key" ON "ExtractedListing"("runId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "CsvFile_runId_key" ON "CsvFile"("runId");

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedListing" ADD CONSTRAINT "ExtractedListing_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsvFile" ADD CONSTRAINT "CsvFile_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
