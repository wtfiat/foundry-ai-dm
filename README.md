# Foundry AI DM

Foundry AI DM is a GM-only, self-hosted AI co-DM module for FoundryVTT. v0 is focused on a local Ollama workflow: connection diagnostics, model/runtime configuration, and the first slice of the Ollama-native adapter.

## Current state

This repository now includes:

- a valid `module.json` manifest,
- a `foundry-ai-dm` package identity in `vite.config.ts`,
- a GM-only configuration submenu,
- a typed Ollama client for `/api/version`, `/api/tags`, `/api/ps`, `/api/chat`, and `/api/embed`,
- browser-side diagnostics for LAN / origin / model-installation issues.

## Local development

### 1. Set the Foundry dev host

The starter template defaults to `localhost:30000`. Your current Foundry server is on `192.168.0.150:30000`, so set these before `yarn dev`:

```powershell
$env:FOUNDRY_HOST_NAME="192.168.0.150"
$env:FOUNDRY_PORT="30000"
```

### 2. Configure Ollama for LAN/browser access

If Ollama is running on `192.168.0.190`, the recommended baseline is:

```powershell
$env:OLLAMA_HOST="0.0.0.0:11434"
$env:OLLAMA_ORIGINS="http://192.168.0.150:30000"
$env:OLLAMA_NO_CLOUD="1"
```

### 3. Install and run

```bash
corepack enable
yarn install
yarn dev
```

## Planned v0 features

- Narrate Scene
- NPC Voice
- Lore / World Q&A
- Session Recap
- retrieval over world journals, scenes, actors, items, and roll tables
- recap and memory journal writes with explicit GM confirmation
