-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('REGISTERED', 'PROVISIONING', 'ACTIVE', 'FAILED', 'PAUSED', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('MOVIE', 'EPISODE');

-- CreateEnum
CREATE TYPE "PushStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ProvisionRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "sshHost" TEXT NOT NULL,
    "sshUser" TEXT NOT NULL,
    "contentApiKey" TEXT,
    "adminEmail" TEXT NOT NULL,
    "flussonicBaseUrl" TEXT NOT NULL,
    "flussonicSecurelinkKey" TEXT NOT NULL DEFAULT '',
    "status" "DeploymentStatus" NOT NULL DEFAULT 'REGISTERED',
    "lastProvisionedAt" TIMESTAMP(3),
    "lastPushAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER,
    "streamPath" TEXT NOT NULL,
    "seasonNumber" INTEGER,
    "episodeNumber" INTEGER,
    "sourcePath" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedByApiKeyId" TEXT,
    "submittedByUserId" TEXT,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushAttempt" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "status" "PushStatus" NOT NULL DEFAULT 'PENDING',
    "httpStatus" INTEGER,
    "errorMessage" TEXT,
    "attemptedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProvisionRun" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "status" "ProvisionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "logText" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProvisionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JarvisUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JarvisUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JarvisApiKey" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "JarvisApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushAttempt_status_nextRetryAt_idx" ON "PushAttempt"("status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "JarvisUser_email_key" ON "JarvisUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "JarvisApiKey_keyHash_key" ON "JarvisApiKey"("keyHash");

-- AddForeignKey
ALTER TABLE "PushAttempt" ADD CONSTRAINT "PushAttempt_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushAttempt" ADD CONSTRAINT "PushAttempt_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvisionRun" ADD CONSTRAINT "ProvisionRun_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
