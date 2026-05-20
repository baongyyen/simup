export type DevicePlatform = "ios" | "android";

export type DeviceState =
  | "Shutdown"
  | "Booted"
  | "Running"
  | "Unavailable"
  | "Unknown";

export type DeviceSource = "simctl" | "android-emulator";

export interface BaseDevice {
  id: string;
  name: string;
  platform: DevicePlatform;
  runtime: string;
  state: DeviceState;
  source: DeviceSource;
  selectable: boolean;
}

export interface IosDevice extends BaseDevice {
  platform: "ios";
  source: "simctl";
  udid: string;
}

export interface AndroidDevice extends BaseDevice {
  platform: "android";
  source: "android-emulator";
  avdName: string;
  serial?: string;
}

export type Device = IosDevice | AndroidDevice;

export interface PlatformDiscovery {
  platform: DevicePlatform;
  available: boolean;
  devices: Device[];
  message?: string;
}

export interface OpenResult {
  device: Device;
  ok: boolean;
  message: string;
}
