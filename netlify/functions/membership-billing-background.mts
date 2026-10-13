import { dispatchBillingWorker, runBillingWorker, verifyBillingWorkerRequest } from "./_shared/membership-billing-worker.mts";

export default async (req: Request) => {
  if (req.method !== "POST") return;
  const body = await req.text();
  if (body.length > 512 || !verifyBillingWorkerRequest(body, req.headers.get("x-billing-worker-signature"))) return;
  let id: string;
  try { id = String(JSON.parse(body)?.id || ""); } catch { return; }
  if (!/^[a-f0-9-]{36}$/.test(id)) return;
  if (await runBillingWorker(id) === "continue") await dispatchBillingWorker(id);
};
