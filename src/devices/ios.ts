import type { IosDevice, OpenResult, PlatformDiscovery } from "./types.js";
import type { CommandRunner } from "../run/command.js";
import { commandExists } from "../run/command.js";

interface SimctlDevice {
  udid: string;
  name: string;
  state?: string;
  isAvailable?: boolean;
  availabilityError?: string;
}

interface SimctlListDevices {
  devices: Record<string, SimctlDevice[]>;
}

const IOS_BOOT_TIMEOUT_MS = 120_000;
const IOS_UNAVAILABLE_MESSAGE = "iOS unavailable: xcrun not found or simctl failed";

export function runtimeName(identifier: string): string {
  const runtime = runtimeSuffix(identifier);
  return runtime.replace(/^iOS-/, "iOS ").replace(/-/g, ".");
}

export function parseSimctlDevices(output: string): IosDevice[] {
  const parsed = JSON.parse(output) as SimctlListDevices;
  const devices: IosDevice[] = [];

  for (const [runtimeIdentifier, runtimeDevices] of Object.entries(parsed.devices)) {
    if (!isIosRuntime(runtimeIdentifier)) {
      continue;
    }

    for (const device of runtimeDevices) {
      if (device.isAvailable === false || device.availabilityError) {
        continue;
      }

      devices.push({
        id: `ios:${device.udid}`,
        name: device.name,
        platform: "ios",
        runtime: runtimeName(runtimeIdentifier),
        state: normalizeSimctlState(device.state),
        source: "simctl",
        selectable: true,
        udid: device.udid,
      });
    }
  }

  return devices.sort((a, b) => `${a.runtime} ${a.name}`.localeCompare(`${b.runtime} ${b.name}`));
}

export async function discoverIosSimulators(runner: CommandRunner): Promise<PlatformDiscovery> {
  try {
    const hasXcrun = await commandExists("xcrun", runner);
    if (!hasXcrun) {
      return iosUnavailable();
    }

    const result = await runner.run("xcrun", ["simctl", "list", "devices", "--json"]);
    if (result.code !== 0) {
      return iosUnavailable();
    }

    return {
      platform: "ios",
      available: true,
      devices: parseSimctlDevices(result.stdout),
    };
  } catch {
    return iosUnavailable();
  }
}

export async function openIosSimulator(
  device: IosDevice,
  runner: CommandRunner,
): Promise<Omit<OpenResult, "device">> {
  try {
    if (device.state !== "Booted") {
      const boot = await runner.run("xcrun", ["simctl", "boot", device.udid]);
      if (boot.code !== 0) {
        return { ok: false, message: `${device.name} failed to boot` };
      }
    }

    const open = await runner.run("open", ["-a", "Simulator"]);
    if (open.code !== 0) {
      return { ok: false, message: `${device.name} failed to open Simulator.app` };
    }

    const bootstatus = await runner.run("xcrun", ["simctl", "bootstatus", device.udid, "-b"], {
      timeoutMs: IOS_BOOT_TIMEOUT_MS,
    });
    if (bootstatus.code !== 0) {
      return { ok: false, message: `${device.name} failed to boot` };
    }

    return { ok: true, message: `${device.name} is ready` };
  } catch (error) {
    return {
      ok: false,
      message: `${device.name} failed to boot: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function isIosRuntime(identifier: string): boolean {
  return runtimeSuffix(identifier).startsWith("iOS-");
}

function runtimeSuffix(identifier: string): string {
  return identifier.slice(identifier.lastIndexOf(".") + 1);
}

function normalizeSimctlState(state: string | undefined): IosDevice["state"] {
  if (state === "Booted" || state === "Shutdown") {
    return state;
  }

  return "Unknown";
}

function iosUnavailable(): PlatformDiscovery {
  return {
    platform: "ios",
    available: false,
    devices: [],
    message: IOS_UNAVAILABLE_MESSAGE,
  };
}
