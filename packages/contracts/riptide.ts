// Riptide Alerts sign-in text, built identically by the browser (to sign) and the keeper (to verify).
export const RIPTIDE_CHANNELS = ["push", "telegram", "email"] as const;
export type RiptideChannel = (typeof RIPTIDE_CHANNELS)[number];

export interface RiptideRequest {
  action: "subscribe" | "unsubscribe";
  account: string;
  channel: RiptideChannel;
  threshold: number; // tide gauge level 0..1
  deliverTo: string; // human label of the target, e.g. an email address or "this browser"
  issuedAt: string; // ISO time, accepted for 10 minutes
}

export function riptideMessage(r: RiptideRequest): string {
  return [
    "OMNITIDE Riptide Alerts",
    `Action: ${r.action}`,
    `Account: ${r.account.toLowerCase()}`,
    `Channel: ${r.channel}`,
    `Alert below: ${Math.round(r.threshold * 100)}% above the sea wall`,
    `Deliver to: ${r.deliverTo}`,
    `Issued: ${r.issuedAt}`,
  ].join("\n");
}
