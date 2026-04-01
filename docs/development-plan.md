# Foundry AI DM v0 Development Plan

## Capability 1 — Product definition and architecture

### Epic 1.1 — Scope control
- Lock the v0 contract.
- Define acceptance scenarios.
- Record architecture decisions.

### Epic 1.2 — Foundation
- Convert the starter template into the Foundry AI DM module.
- Add a module manifest.
- Register settings and a GM-only configuration menu.

## Capability 2 — Ollama-native integration

### Epic 2.1 — Connectivity
- Build a typed Ollama client.
- Add diagnostics for `/api/version`, `/api/tags`, and `/api/ps`.
- Surface missing model and likely CORS/LAN issues.

### Epic 2.2 — Runtime shaping
- Add streaming chat handling.
- Add structured-output requests for recap and memory payloads.
- Expose model runtime options like keep-alive, context window, and temperature.

## Capability 3 — Retrieval and context assembly

### Epic 3.1 — Document extraction
- Normalize journals, scenes, actors, items, and roll tables into retrieval records.
- Add include and exclude controls by document type.

### Epic 3.2 — Embeddings and search
- Build a client-side vector index using Ollama embeddings.
- Support incremental re-indexing for changed content.
- Assemble prompt context from top-K retrieval plus active scene state.

## Capability 4 — GM co-DM workflows

### Epic 4.1 — Interaction modes
- Narrate Scene
- NPC Voice
- Lore / World Q&A
- Session Recap

### Epic 4.2 — Safe persistence
- Save recaps and memory notes into dedicated journal namespaces.
- Require GM confirmation for all write operations.

## Capability 5 — Quality and release

### Epic 5.1 — Hardening
- Add tests for the Ollama client, response parsing, and retrieval chunking.
- Run manual playtests with scripted scenarios.

### Epic 5.2 — Release candidate
- Finalize documentation.
- Package a v0 release candidate.
