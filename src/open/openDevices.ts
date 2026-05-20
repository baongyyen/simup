import type { Device, OpenResult } from "../devices/types.js";

export interface OpenDevicesSummary {
  ok: boolean;
  results: OpenResult[];
}

export type DeviceOpener = (device: Device) => Promise<OpenResult>;

export async function openDevices(
  devices: Device[],
  opener: DeviceOpener,
  concurrency = 2,
): Promise<OpenDevicesSummary> {
  if (devices.length === 0) {
    return { ok: true, results: [] };
  }

  const normalizedConcurrency = Number.isFinite(concurrency) ? Math.trunc(concurrency) : 1;
  const results: OpenResult[] = new Array(devices.length);
  const workerCount = Math.min(Math.max(normalizedConcurrency, 1), devices.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < devices.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const device = devices[currentIndex];

      try {
        results[currentIndex] = await opener(device);
      } catch (error) {
        results[currentIndex] = {
          device,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    ok: results.every((result) => result.ok),
    results,
  };
}
