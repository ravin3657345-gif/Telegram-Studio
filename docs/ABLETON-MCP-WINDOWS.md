# Ableton Live 12 + Freebuff Desktop (Windows)

This app does not currently contain an MCP host/configuration layer, so the Ableton connection is configured in the Freebuff Desktop MCP settings rather than in the Telegram Studio source tree.

## Recommended connector

Use [`ahujasid/ableton-mcp`](https://github.com/ahujasid/ableton-mcp). It provides an MCP server plus an Ableton Remote Script and supports session inspection, tracks, clips, MIDI notes, devices, browser loading, arrangement, and transport control.

The connector runs locally. Disable its optional telemetry in the MCP entry below.

## Install prerequisites

1. Install **uv** for Windows from <https://docs.astral.sh/uv/getting-started/installation/>.
2. Open PowerShell and verify:

```powershell
uv --version
```

## Install the Ableton Remote Script

Run:

```powershell
uvx --from ableton-mcp ableton-mcp-install-script
```

To preview detected target folders first:

```powershell
uvx --from ableton-mcp ableton-mcp-install-script --list-targets
```

If Live's User Library is in a non-default location, specify its `Remote Scripts` directory explicitly:

```powershell
uvx --from ableton-mcp ableton-mcp-install-script --target "C:\path\to\Ableton\User Library\Remote Scripts"
```

The normal Windows location is:

```text
C:\Users\<username>\Documents\Ableton\User Library\Remote Scripts\AbletonMCP
```

## Configure Ableton Live

1. Restart Ableton Live 12.
2. Open **Options → Preferences → Link, Tempo & MIDI**.
3. In a free **Control Surface** row select **AbletonMCP**.
4. Set **Input** and **Output** to **None**.
5. Keep Live open with the set you want to control.

## Configure Freebuff Desktop

Add this MCP server in Freebuff Desktop's MCP settings:

```json
{
  "mcpServers": {
    "AbletonMCP": {
      "command": "uvx",
      "args": ["ableton-mcp"],
      "env": {
        "ABLETON_MCP_DISABLE_TELEMETRY": "true"
      }
    }
  }
}
```

If Freebuff asks for a command and arguments separately:

- Command: `uvx`
- Arguments: `ableton-mcp`
- Environment variable: `ABLETON_MCP_DISABLE_TELEMETRY=true`

Restart Freebuff Desktop after saving the MCP entry. Only run one AbletonMCP server instance at a time.

## First test

With Live and Freebuff running, try:

> Get the current Ableton session: tempo, tracks, scenes, and selected track.

Then test a reversible operation:

> Set the tempo to 120 BPM, but do not create or delete anything.

For destructive operations such as deleting tracks or clips, save the Live set first and ask for confirmation before executing them.

## Troubleshooting

- **AbletonMCP is missing from Control Surface:** restart Live after running the installer and verify the folder is under the actual User Library shown in Preferences → Library.
- **MCP server starts but cannot connect:** ensure Live is open and AbletonMCP is selected as a Control Surface; close duplicate `uvx ableton-mcp` processes.
- **`uvx` is not recognized:** restart PowerShell after installing uv, or use the full path reported by the uv installer.
- **Connection timeout:** restart Live first, then restart Freebuff; do not run multiple MCP clients against the same Remote Script.

This setup is third-party and is not an official Ableton product.
