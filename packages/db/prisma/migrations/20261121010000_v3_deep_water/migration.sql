
-- CreateTable
CREATE TABLE "DeepBook" (
    "id" TEXT NOT NULL,
    "owner" TEXT,
    "salt" TEXT,
    "viewKey" TEXT,
    "book" JSONB NOT NULL,
    "intentNonce" INTEGER NOT NULL DEFAULT 0,
    "dirty" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeepBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppliedEvent" (
    "key" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedEvent_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Cursor" (
    "name" TEXT NOT NULL,
    "block" BIGINT NOT NULL,

    CONSTRAINT "Cursor_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "DeepBook_owner_idx" ON "DeepBook"("owner");

