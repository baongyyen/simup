#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  discoverAndroidEmulators,
  openAndroidEmulator,
} from "./devices/android.js";
import {
  discoverIosSimulators,
  openIosSimulator,
} from "./devices/ios.js";
import type {
  AndroidDevice,
  Device,
  IosDevice,
  OpenResult,
  PlatformDiscovery,
} from "./devices/types.js";
import { openDevices as openDevicesImpl, type OpenDevicesSummary } from "./open/openDevices.js";
import { createNodeCommandRunner, type CommandRunner } from "./run/command.js";
import { NoSelectableDevices, pickDevices as pickDevicesImpl, UserCancelled } from "./ui/picker.js";

const HELP_TEXT =
  "simup\n\n" +
  "Usage: simup [--help]\n\n" +
  "Interactively select iOS simulators and Android emulators, open them, and wait until they are ready.\n";

interface CliWriter {
  write(chunk: string): unknown;
}

export interface CliDeps {
  createRunner: () => CommandRunner;
  discoverIos: (runner: CommandRunner) => Promise<PlatformDiscovery>;
  discoverAndroid: (runner: CommandRunner) => Promise<PlatformDiscovery>;
  pickDevices: (discoveries: PlatformDiscovery[]) => Promise<Device[]>;
  openDevices: (
    devices: Device[],
    opener: (device: Device) => Promise<OpenResult>,
  ) => Promise<OpenDevicesSummary>;
  openIos: (
    device: IosDevice,
    runner: CommandRunner,
  ) => Promise<Omit<OpenResult, "device">>;
  openAndroid: (
    device: AndroidDevice,
    runner: CommandRunner,
  ) => Promise<Omit<OpenResult, "device">>;
  stdout: CliWriter;
  stderr: CliWriter;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  return runCli(defaultDeps(), argv);
}

export async function runCli(deps: CliDeps, argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    deps.stdout.write(HELP_TEXT);
    return 0;
  }

  const runner = deps.createRunner();
  const discoveries = await Promise.all([
    deps.discoverIos(runner),
    deps.discoverAndroid(runner),
  ]);

  for (const discovery of discoveries) {
    if (!discovery.available && discovery.message) {
      deps.stdout.write(`${discovery.message}\n`);
    }
  }

  if (discoveries.every((discovery) => discovery.devices.length === 0)) {
    deps.stderr.write("No simulators or emulators found\n");
    return 1;
  }

  let selectedDevices: Device[];
  try {
    selectedDevices = await deps.pickDevices(discoveries);
  } catch (error) {
    if (error instanceof UserCancelled) {
      return 0;
    }

    if (error instanceof NoSelectableDevices) {
      deps.stderr.write(`${error.message}\n`);
      return 1;
    }

    throw error;
  }

  deps.stdout.write(`Opening ${selectedDevices.length} device(s)...\n`);
  const summary = await deps.openDevices(selectedDevices, async (device) => {
    const result =
      device.platform === "ios"
        ? await deps.openIos(device, runner)
        : await deps.openAndroid(device, runner);

    return {
      device,
      ...result,
    };
  });

  for (const result of summary.results) {
    deps.stdout.write(`${result.ok ? "READY" : "FAILED"} ${result.device.name}: ${result.message}\n`);
  }

  return summary.ok ? 0 : 1;
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

function defaultDeps(): CliDeps {
  return {
    createRunner: createNodeCommandRunner,
    discoverIos: discoverIosSimulators,
    discoverAndroid: discoverAndroidEmulators,
    pickDevices: pickDevicesImpl,
    openDevices: openDevicesImpl,
    openIos: openIosSimulator,
    openAndroid: openAndroidEmulator,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

if (isDirectExecution()) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
