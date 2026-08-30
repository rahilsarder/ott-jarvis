-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "sshKeyInstalledAt" TIMESTAMP(3),
ADD COLUMN     "sshPort" INTEGER NOT NULL DEFAULT 22;
