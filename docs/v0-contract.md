# Foundry AI DM v0 Contract

## Product goal

A GM-only, self-hosted AI co-DM module for FoundryVTT that uses local Ollama models to:

- narrate scenes,
- roleplay NPCs,
- answer lore and world questions from indexed Foundry data,
- generate and save session recaps and memory notes.

## In scope

- Foundry-native module UI.
- Ollama-native HTTP integration.
- Retrieval over world Journal Entries, Scenes, Actors, Items, and Roll Tables.
- Four v0 modes:
  - Narrate Scene
  - NPC Voice
  - Lore / World Q&A
  - Session Recap
- Safe writes only to recap and memory journals, always behind GM confirmation.

## Out of scope

- Combat mutation.
- Token movement.
- Macro execution.
- Arbitrary JavaScript execution.
- Player-facing agent autonomy.
- MCP integration.
- Cloud model access.

## Success criteria

v0 is complete when the GM can:

1. open the module UI,
2. connect to a local Ollama host,
3. inspect installed models and connection health,
4. index the supported document types,
5. use the four v0 modes,
6. preview and confirm recap or memory saves,
7. retrieve saved recap and memory data in later prompts.
