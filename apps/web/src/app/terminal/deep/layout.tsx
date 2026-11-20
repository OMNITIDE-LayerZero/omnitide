import { notFound } from "next/navigation";
import { FEATURES } from "@/lib/contracts";

// mainnet ships version by version; this view opens once its contracts are deployed
export default function Layout({ children }: { children: React.ReactNode }) {
  if (!FEATURES.deepWater) notFound();
  return children;
}
