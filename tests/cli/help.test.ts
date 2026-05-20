import { describe, expect, it, vi } from "vitest";
import type { Device, OpenResult, PlatformDiscovery } from "../../src/devices/types.js";
import { main, runCli } from "../../src/cli.js";
import { NoSelectableDevices, UserCancelled } from "../../src/ui/picker.js";
import type { CommandRunner } from "../../src/run/command.js";

const helpText =
  "simup\n\n" +
  "Usage: simup [--help]\n\n" +
  "Interactively select iOS simulators and Android emulators, open them, and wait until they are ready.\n";

const iosDevice: Device = {
  id: "ios:ABC",
  name: "iPhone 16",
  platform: "ios",
  runtime: "iOS 18.2",
  state: "Shutdown",
  source: "simctl",
  selectable: true,
  udid: "ABC",
};

const androidDevice: Device = {
  id: "android:Pixel_8",
  name: "Pixel_8",
  platform: "android",
  runtime: "Android AVD",
  state: "Shutdown",
  source: "android-emulator",
  selectable: true,
  avdName: "Pixel_8",
};

const iosDiscovery: PlatformDiscovery = {
  platform: "ios",
  available: true,
  devices: [iosDevice],
};

const androidDiscovery: PlatformDiscovery = {
  platform: "android",
  available: true,
  devices: [androidDevice],
};

function cliHarness(overrides: Partial<Parameters<typeof runCli>[0]> = {}) {
  let stdout = "";
  let stderr = "";
  const runner: CommandRunner = {
    run: vi.fn(),
  };
  const deps: Parameters<typeof runCli>[0] = {
    createRunner: vi.fn(() => runner),
    discoverIos: vi.fn(async () => iosDiscovery),
    discoverAndroid: vi.fn(async () => androidDiscovery),
    pickDevices: vi.fn(async () => [iosDevice]),
    openDevices: vi.fn(async (_devices, opener) => ({
      ok: true,
      results: [await opener(iosDevice)],
    })),
    openIos: vi.fn(async (device) => ({
      ok: true,
      message: `${device.name} is ready`,
    })),
    openAndroid: vi.fn(async (device) => ({
      ok: true,
      message: `${device.name} is ready`,
    })),
    stdout: { write: (chunk: string) => { stdout += chunk; } },
    stderr: { write: (chunk: string) => { stderr += chunk; } },
    ...overrides,
  };

  return {
    deps,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

describe("CLI", () => {
  it("prints help and returns success", async () => {
    const harness = cliHarness();

    await expect(runCli(harness.deps, ["--help"])).resolves.toBe(0);

    expect(harness.stdout).toBe(helpText);
    expect(harness.stderr).toBe("");
    expect(harness.deps.createRunner).not.toHaveBeenCalled();
  });

  it("main prints help and returns success", async () => {
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      await expect(main(["--help"])).resolves.toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(chunks.join("")).toBe(helpText);
  });


  it("prints help for -h", async () => {
    const harness = cliHarness();

    await expect(runCli(harness.deps, ["-h"])).resolves.toBe(0);

    expect(harness.stdout).toBe(helpText);
    expect(harness.stderr).toBe("");
    expect(harness.deps.createRunner).not.toHaveBeenCalled();
  });

  it("returns failure when discovery finds no devices", async () => {
    const harness = cliHarness({
      discoverIos: vi.fn(async () => ({ platform: "ios", available: true, devices: [] })),
      discoverAndroid: vi.fn(async () => ({ platform: "android", available: true, devices: [] })),
    });

    await expect(runCli(harness.deps, [])).resolves.toBe(1);

    expect(harness.stdout).toBe("");
    expect(harness.stderr).toBe("No simulators or emulators found\n");
    expect(harness.deps.pickDevices).not.toHaveBeenCalled();
  });

  it("prints unavailable discovery messages to stdout", async () => {
    const harness = cliHarness({
      discoverIos: vi.fn(async () => ({
        platform: "ios",
        available: false,
        devices: [],
        message: "iOS unavailable: xcrun not found or simctl failed",
      })),
      discoverAndroid: vi.fn(async () => androidDiscovery),
    });

    await expect(runCli(harness.deps, [])).resolves.toBe(0);

    expect(harness.stdout).toContain("iOS unavailable: xcrun not found or simctl failed\n");
  });

  it("returns success when the user cancels picking", async () => {
    const harness = cliHarness({
      pickDevices: vi.fn(async () => {
        throw new UserCancelled();
      }),
    });

    await expect(runCli(harness.deps, [])).resolves.toBe(0);

    expect(harness.stderr).toBe("");
    expect(harness.deps.openDevices).not.toHaveBeenCalled();
  });

  it("prints a clear message when no devices are selectable", async () => {
    const harness = cliHarness({
      pickDevices: vi.fn(async () => {
        throw new NoSelectableDevices();
      }),
    });

    await expect(runCli(harness.deps, [])).resolves.toBe(1);

    expect(harness.stderr).toBe("No selectable simulators or emulators found\n");
    expect(harness.deps.openDevices).not.toHaveBeenCalled();
  });

  it("opens selected devices and prints each result", async () => {
    const harness = cliHarness({
      pickDevices: vi.fn(async () => [iosDevice, androidDevice]),
      openDevices: vi.fn(async (devices, opener) => ({
        ok: false,
        results: [
          await opener(devices[0]),
          {
            ...(await opener(devices[1])),
            ok: false,
            message: "Pixel_8 failed to boot",
          },
        ],
      })),
    });

    await expect(runCli(harness.deps, [])).resolves.toBe(1);

    expect(harness.stdout).toBe(
      "Opening 2 device(s)...\n" +
        "READY iPhone 16: iPhone 16 is ready\n" +
        "FAILED Pixel_8: Pixel_8 failed to boot\n",
    );
    expect(harness.deps.openIos).toHaveBeenCalledWith(iosDevice, expect.anything());
    expect(harness.deps.openAndroid).toHaveBeenCalledWith(androidDevice, expect.anything());
  });

  it("rethrows unexpected picker errors for direct execution handler", async () => {
    const harness = cliHarness({
      pickDevices: vi.fn(async () => {
        throw new Error("unexpected picker failure");
      }),
    });

    await expect(runCli(harness.deps, [])).rejects.toThrow("unexpected picker failure");
  });
});
