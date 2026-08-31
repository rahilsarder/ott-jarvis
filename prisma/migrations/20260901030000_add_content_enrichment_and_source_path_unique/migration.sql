-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "backdropUrl" TEXT,
ADD COLUMN     "genreNames" TEXT[],
ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "posterUrl" TEXT,
ADD COLUMN     "synopsis" TEXT,
ADD COLUMN     "tmdbId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_sourcePath_key" ON "ContentItem"("sourcePath");

