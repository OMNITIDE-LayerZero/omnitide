-- CreateTable
CREATE TABLE "Candle" (
    "feed" TEXT NOT NULL,
    "interval" SMALLINT NOT NULL,
    "start" TIMESTAMPTZ(3) NOT NULL,
    "open" DECIMAL(24,8) NOT NULL,
    "high" DECIMAL(24,8) NOT NULL,
    "low" DECIMAL(24,8) NOT NULL,
    "close" DECIMAL(24,8) NOT NULL,
    "ticks" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Candle_pkey" PRIMARY KEY ("feed","interval","start")
);

-- CreateTable
CREATE TABLE "PriceLatest" (
    "feed" TEXT NOT NULL,
    "price" DECIMAL(24,8) NOT NULL,
    "source" TEXT NOT NULL,
    "observed" TIMESTAMPTZ(3) NOT NULL,
    "change24h" DECIMAL(12,6),

    CONSTRAINT "PriceLatest_pkey" PRIMARY KEY ("feed")
);

-- CreateTable
CREATE TABLE "Heartbeat" (
    "service" TEXT NOT NULL,
    "beatAt" TIMESTAMPTZ(3) NOT NULL,
    "detail" JSONB,

    CONSTRAINT "Heartbeat_pkey" PRIMARY KEY ("service")
);

-- CreateIndex
CREATE INDEX "Candle_feed_interval_start_idx" ON "Candle"("feed", "interval", "start" DESC);
