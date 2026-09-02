-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationExpires" TIMESTAMP(3),
ADD COLUMN     "emailVerificationTokenHash" TEXT,
ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerificationTokenHash_key" ON "User"("emailVerificationTokenHash");

