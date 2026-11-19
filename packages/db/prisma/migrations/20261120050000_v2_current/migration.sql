-- CreateTable
CREATE TABLE "AccountSnapshot" (
    "account" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "equity" DECIMAL(24,6) NOT NULL,
    "collateral" DECIMAL(24,6) NOT NULL,
    "upnl" DECIMAL(24,6) NOT NULL,
    "notional" DECIMAL(24,6) NOT NULL,
    "maintenance" DECIMAL(24,6) NOT NULL,

    CONSTRAINT "AccountSnapshot_pkey" PRIMARY KEY ("account","at")
);

-- CreateTable
CREATE TABLE "HarborSnapshot" (
    "at" TIMESTAMPTZ(3) NOT NULL,
    "totalAssets" DECIMAL(24,6) NOT NULL,
    "totalSupply" DECIMAL(24,6) NOT NULL,

    CONSTRAINT "HarborSnapshot_pkey" PRIMARY KEY ("at")
);

-- CreateTable
CREATE TABLE "AlertSubscription" (
    "id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMPTZ(3),
    "lastLevel" DOUBLE PRECISION,

    CONSTRAINT "AlertSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertSubscription_account_channel_key" ON "AlertSubscription"("account", "channel");

