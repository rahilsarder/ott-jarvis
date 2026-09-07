-- CreateEnum
CREATE TYPE "MaturityRating" AS ENUM ('G', 'PG', 'PG_13', 'R', 'NC_17', 'TV_Y', 'TV_G', 'TV_PG', 'TV_14', 'TV_MA');

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "creditsLeadSec" INTEGER,
ADD COLUMN     "durationSec" INTEGER,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "rating" "MaturityRating",
ADD COLUMN     "trailerYoutubeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PushAttempt_contentItemId_deploymentId_key" ON "PushAttempt"("contentItemId", "deploymentId");
