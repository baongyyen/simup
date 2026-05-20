import { checkbox } from "@inquirer/prompts";
import type { Device, DevicePlatform, PlatformDiscovery } from "../devices/types.js";

export class UserCancelled extends Error {
  constructor() {
    super("User cancelled");
    this.name = "UserCancelled";
  }
}

export class NoSelectableDevices extends Error {
  constructor() {
    super("No selectable simulators or emulators found");
    this.name = "NoSelectableDevices";
  }
}

export interface DeviceChoice {
  name: string;
  value: string;
  disabled: boolean | string;
}

export interface PromptContext {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
}

export function formatDeviceLabel(device: Device): string {
  return `${device.name} (${device.runtime}) - ${device.state}`;
}

export function buildDeviceChoices(discoveries: PlatformDiscovery[]): DeviceChoice[] {
  return discoveries.flatMap((discovery) => [
    {
      name: formatDiscoveryHeader(discovery.platform),
      value: `header:${discovery.platform}`,
      disabled: discovery.message ?? true,
    },
    ...discovery.devices.map((device) => ({
      name: formatDeviceLabel(device),
      value: device.id,
      disabled: device.selectable ? false : "Unavailable",
    })),
  ]);
}

export function resolveSelectedDevices(
  selectedIds: string[],
  discoveries: PlatformDiscovery[],
): Device[] {
  const devicesById = new Map<string, Device>();
  for (const discovery of discoveries) {
    for (const device of discovery.devices) {
      devicesById.set(device.id, device);
    }
  }

  return selectedIds
    .map((selectedId) => devicesById.get(selectedId))
    .filter((device): device is Device => device !== undefined);
}

export async function pickDevices(
  discoveries: PlatformDiscovery[],
  context: PromptContext = {},
): Promise<Device[]> {
  const choices = buildDeviceChoices(discoveries);
  if (!choices.some((choice) => choice.disabled === false)) {
    throw new NoSelectableDevices();
  }

  const input = context.input ?? process.stdin;

  while (true) {
    let selectedIds: string[];
    const abortController = new AbortController();
    const onKeypress = (_: string, key: { name?: string } | undefined): void => {
      if (key?.name === "escape") {
        abortController.abort();
      }
    };

    try {
      input.on("keypress", onKeypress);
      selectedIds = await checkbox<string>({
        message: "Select devices to open",
        choices,
      }, {
        ...context,
        signal: abortController.signal,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "ExitPromptError" || error.name === "AbortPromptError")
      ) {
        throw new UserCancelled();
      }

      throw error;
    } finally {
      input.removeListener("keypress", onKeypress);
    }

    const selectedDevices = resolveSelectedDevices(selectedIds, discoveries);

    if (selectedDevices.length > 0) {
      return selectedDevices;
    }

    process.stdout.write("Select at least one device.\n");
  }
}

function formatDiscoveryHeader(platform: DevicePlatform): string {
  return platform === "ios" ? "iOS Simulators" : "Android Emulators";
}
