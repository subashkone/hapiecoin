// Web Worker entry: the pricing engine runs off the main thread (frontend rule: pricing in a Web Worker).
// Loaded by client.ts with `new Worker(new URL("./worker.ts", import.meta.url))`; Next bundles it.
import { attachPricingWorker } from "@hapiecoin/pricing";

attachPricingWorker(self as unknown as Parameters<typeof attachPricingWorker>[0]);
