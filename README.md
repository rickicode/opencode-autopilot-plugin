# OpenCode Autopilot Plugin

Autonomous multi-step execution for OpenCode using superpowers workflow.

## Installation

```bash
npm install
npm run build
```

## Usage

```bash
/autopilot "add user authentication"
/autopilot --loops 15 "refactor database"
/autopilot off
/autopilot status
/autopilot resume
```

## Configuration

Add to `~/.config/opencode/opencode.json`:

```jsonc
{
  "autopilot": {
    "defaultMaxLoops": 10,
    "maxLoopsPerPhase": 5,
    "cooldownMs": 2000,
    "stopOnError": true,
    "stopBeforeMerge": true
  }
}
```
