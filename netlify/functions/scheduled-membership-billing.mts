import type { Config } from "@netlify/functions";
import { scheduleBillingRun } from "./_shared/membership-billing-worker.mts";

export default async () => {
  await scheduleBillingRun();
};

export const config: Config = { schedule: "*/5 * * * *" };
