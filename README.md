# simup

Interactive CLI for opening local iOS simulators and Android emulators.

## Requirements

- Node.js 20+
- pnpm
- Xcode command line tools for iOS Simulator support
- Android SDK `emulator` and `adb` in PATH for Android Emulator support

## Install

```sh
pnpm install
pnpm build
pnpm link --global
```

## Usage

```sh
simup
```

Use the arrow keys to move, Space to select one or more devices, Enter to open, and Escape or Ctrl+C to exit.

`opensimu` is kept as a compatibility alias for the old command name.

## Development

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```
