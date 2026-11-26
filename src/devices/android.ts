import type { AndroidDevice, OpenResult, PlatformDiscovery } from "./types.js";
import type { CommandRunner } from "../run/command.js";
import { commandExists } from "../run/command.js";

const ANDROID_BOOT_TIMEOUT_MS = 180_000;
const ANDROID_BOOT_POLL_INTERVAL_MS = 250;
const ANDROID_UNAVAILABLE_FAILED = "Android unavailable: emulator or adb failed";

export function parseAvdList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseAdbDevices(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial?.startsWith("emulator-") && state === "device")
    .map(([serial]) => serial);
}

export async function discoverAndroidEmulators(
  runner: CommandRunner,
): Promise<PlatformDiscovery> {
  try {
    const hasEmulator = await commandExists("emulator", runner);
    if (!hasEmulator) {
      return androidUnavailable("emulator");
    }

    const hasAdb = await commandExists("adb", runner);
    if (!hasAdb) {
      return androidUnavailable("adb");
    }

    const avds = await runner.run("emulator", ["-list-avds"]);
    const adbDevices = await runner.run("adb", ["devices"]);
    if (avds.code !== 0 || adbDevices.code !== 0) {
      return androidFailed();
    }

    const avdNames = parseAvdList(avds.stdout);
    const serialByAvdName = await mapRunningSerialsByAvdName(parseAdbDevices(adbDevices.stdout), runner);

    return {
      platform: "android",
      available: true,
      devices: avdNames.map((avdName) => androidDevice(avdName, serialByAvdName.get(avdName))),
    };
  } catch {
    return androidFailed();
  }
}

export async function openAndroidEmulator(
  device: AndroidDevice,
  runner: CommandRunner,
): Promise<Omit<OpenResult, "device">> {
  try {
    let serial = device.serial;

    if (device.state !== "Running") {
      const start = await runner.run("emulator", ["-avd", device.avdName], { detached: true });
      if (start.code !== 0) {
        return { ok: false, message: `${device.name} failed to boot` };
      }
      serial = await waitForAvdSerial(device.avdName, runner);
      if (!serial) {
        return { ok: false, message: `${device.name} failed to boot` };
      }
    }

    if (!serial) {
      return { ok: false, message: `${device.name} failed to boot` };
    }

    const wait = await runner.run("adb", ["-s", serial, "wait-for-device"], {
      timeoutMs: ANDROID_BOOT_TIMEOUT_MS,
    });
    if (wait.code !== 0) {
      return { ok: false, message: `${device.name} failed to boot` };
    }

    const isReady = await waitForBootCompleted(serial, runner);
    if (!isReady) {
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

function androidDevice(avdName: string, serial: string | undefined): AndroidDevice {
  return {
    id: `android:${avdName}`,
    name: avdName,
    platform: "android",
    runtime: "Android AVD",
    state: serial ? "Running" : "Shutdown",
    source: "android-emulator",
    selectable: true,
    avdName,
    ...(serial ? { serial } : {}),
  };
}

async function mapRunningSerialsByAvdName(
  serials: string[],
  runner: CommandRunner,
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    serials.map(async (serial) => {
      const avdName = await getAvdNameForSerial(serial, runner, ANDROID_BOOT_TIMEOUT_MS);
      if (!avdName) {
        throw new Error(`Failed to map Android emulator serial ${serial} to an AVD name`);
      }
      return [avdName, serial] satisfies [string, string];
    }),
  );

  return new Map(entries);
}

async function getAvdNameForSerial(
  serial: string,
  runner: CommandRunner,
  timeoutMs: number,
): Promise<string | undefined> {
  const result = await runner.run("adb", ["-s", serial, "emu", "avd", "name"], { timeoutMs });
  if (result.code !== 0) {
    return undefined;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line !== "OK");
}

async function waitForAvdSerial(
  avdName: string,
  runner: CommandRunner,
): Promise<string | undefined> {
  const deadline = Date.now() + ANDROID_BOOT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const devices = await runner.run("adb", ["devices"], { timeoutMs: remainingMs(deadline) });
    if (devices.code === 0) {
      for (const serial of parseAdbDevices(devices.stdout)) {
        const runningAvdName = await getAvdNameForSerial(serial, runner, remainingMs(deadline));
        if (runningAvdName === avdName) {
          return serial;
        }
      }
    }

    await sleep(ANDROID_BOOT_POLL_INTERVAL_MS);
  }

  return undefined;
}

async function waitForBootCompleted(
  serial: string,
  runner: CommandRunner,
): Promise<boolean> {
  const deadline = Date.now() + ANDROID_BOOT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await runner.run(
      "adb",
      ["-s", serial, "shell", "getprop", "sys.boot_completed"],
      { timeoutMs: remainingMs(deadline) },
    );
    if (result.code === 0 && result.stdout.trim() === "1") {
      return true;
    }

    await sleep(ANDROID_BOOT_POLL_INTERVAL_MS);
  }

  return false;
}

function remainingMs(deadline: number): number {
  return Math.max(deadline - Date.now(), 1);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function androidUnavailable(tool: "emulator" | "adb"): PlatformDiscovery {
  return {
    platform: "android",
    available: false,
    devices: [],
    message: `Android unavailable: ${tool} not found`,
  };
}

function androidFailed(): PlatformDiscovery {
  return {
    platform: "android",
    available: false,
    devices: [],
    message: ANDROID_UNAVAILABLE_FAILED,
  };
}
