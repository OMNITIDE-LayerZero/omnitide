import type { Metadata } from "next";
import { TerminalShell } from "@/components/terminal/shell";

export const metadata: Metadata = { title: "Terminal" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <TerminalShell>{children}</TerminalShell>;
}
