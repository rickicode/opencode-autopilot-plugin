# OpenCode Autopilot Plugin

Autonomous multi-step execution for OpenCode using superpowers workflow.

## Prerequisites

- OpenCode installed
- Superpowers agent at `~/.config/opencode/agents/superpowers.md`
- Node.js 18+ and npm

## Installation

1. Clone and build:

```bash
git clone <repo-url> autopilot-plugin
cd autopilot-plugin
npm install
npm run build
```

2. Link plugin to OpenCode:

```bash
# Create plugins directory if not exists
mkdir -p ~/.config/opencode/plugins

# Link plugin
ln -s $(pwd) ~/.config/opencode/plugins/autopilot
```

3. Register plugin in OpenCode config:

Edit `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugins": [
    "autopilot"
  ],
  "autopilot": {
    "defaultMaxLoops": 10,
    "maxLoopsPerPhase": 5,
    "cooldownMs": 2000,
    "stopOnError": true,
    "stopBeforeMerge": true
  }
}
```

4. Restart OpenCode

## Usage

### Basic Usage

```bash
# Start autopilot with default max loops (10)
/autopilot "add user authentication with JWT"

# Override max loops
/autopilot --loops 15 "refactor database layer"

# Check status
/autopilot status

# Disable autopilot
/autopilot off

# Resume from last stop
/autopilot resume
```

### How It Works

1. `/autopilot "task"` triggers superpowers agent in autonomous mode
2. Agent proceeds through workflow phases automatically:
   - Design (brainstorming)
   - Plan (writing-plans)
   - Execute (subagent-driven-development)
   - Verify (verification-before-completion)
   - Complete (finishing-a-development-branch)
3. Agent stops only for critical decisions or failures
4. Each auto-proceed counts as 1 loop
5. Stops when max loops reached or user interrupts

### Safety Gates

Autopilot STOPS and asks for user input when:
- **Design:** Ambiguous requirements, multiple valid approaches
- **Plan:** Critical gaps, missing dependencies
- **Execute:** Implementer blocked, verification failed
- **Complete:** Always stops before merge/PR (user decides)

### Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `defaultMaxLoops` | 10 | Default max loops when no `--loops` flag |
| `maxLoopsPerPhase` | 5 | Max loops per workflow phase |
| `cooldownMs` | 2000 | Delay before auto-continue (ms) |
| `stopOnError` | true | Stop on any error |
| `stopBeforeMerge` | true | Always stop before merge/PR |

## Troubleshooting

**Plugin not loading:**
- Check `~/.config/opencode/opencode.json` has `"plugins": ["autopilot"]`
- Verify symlink: `ls -la ~/.config/opencode/plugins/autopilot`
- Check build: `ls -la dist/`

**Command not recognized:**
- Restart OpenCode after installation
- Check plugin loaded: OpenCode should show autopilot in plugins list

**Autopilot not proceeding:**
- Check `/autopilot status` for current state
- Verify superpowers agent exists and is configured
- Check OpenCode logs for errors

## Development

```bash
# Watch mode
npm run watch

# Clean build
npm run clean && npm run build

# Run tests
npm test
```

## License

MIT
