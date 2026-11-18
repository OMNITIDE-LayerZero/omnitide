import { Suspense } from "react";
import { TradeView } from "@/components/terminal/trade-view";

export default function TradePage() {
  return (
    <Suspense>
      <TradeView />
    </Suspense>
  );
}
