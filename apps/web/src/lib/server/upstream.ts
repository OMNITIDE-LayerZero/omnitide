import "server-only";
import { env } from "./env";

/** GET JSON from the keeper or indexer on localhost with a short timeout. */
export async function upstream<T>(service: "keeper" | "indexer", path: string, revalidate = 0): Promise<T> {
  const base = service === "keeper" ? env().KEEPER_URL : env().INDEXER_URL;
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5_000), ...(revalidate ? { next: { revalidate } } : { cache: "no-store" }) });
  if (!res.ok) throw new Error(`${service} ${res.status}`);
  return (await res.json()) as T;
}
