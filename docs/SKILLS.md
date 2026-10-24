# PalAI Check â€” development skills

This document records requested development aids and their boundaries. Their installation is not a product feature or a build-completion requirement.

## Current status

No requested third-party skill was successfully installed or reviewed in this session. Earlier repository fetches failed with:
<urlopen error [Errno 11001] getaddrinfo failed>

The codex executable was not found on PATH during that check. Do not interpret the presence of this file as proof that skills are installed or loaded.

## Requested selection

| Skill/package | Use | Instruction |
| --- | --- | --- |
| ponytail | Small implementation and complexity review | Include ponytail-review and ponytail-help if supplied by the reviewed package |
| graphify / graphifyy | Query code/document relationships | Do not run on the repository yet |
| taste-skill | Implement visual direction | Install only taste-skill and redesign-skill from that package |
| official OpenAI frontend-skill | Frontend implementation | Verify actual catalog availability and installer first |
| web-design-guidelines | UI/accessibility review | Use for focused review |
| ui-ux-pro-max | UX/design-system reasoning | Follow approved flat style and source inspiration |
| uncodixfy | Design-pattern review | DO NOT INSTALL until source/scripts are reviewed and the user explicitly says yes |
| emil-design-eng | Interaction polish | Optional; if the requested command fails, skip and report exact error |

For taste-skill, skip output-skill and stitch-skill as requested by the user. Do not let a skill rewrite DESIGN.md or change the agreed product scope without coordination.

## Installation rules retained from the user

- Before installing each skill, inspect SKILL.md and relevant scripts. Stop and ask if it requests secrets, unusual global changes or unrelated network/file access.
- If a command fails, report the exact error rather than inventing a workaround. Do not use sudo.
- Interactive installers must select only the named skills.
- Do not alter existing global skills/config beyond the authorized installs.
- For Ponytail hook trust, explain the exact verified trust prompt and user action; do not pre-authorize unseen hooks.
- Uncodixfy requires inspection of SKILL.md and all scripts from https://github.com/cyxzdev/uncodixfy, including shell commands, network calls and writes outside its folder, before explicit user consent.
- Graphify must remain unrun until the user directs it after code exists.

Installation work was not retried as part of this documentation task. If installation becomes possible later, record verified status and any unresolved trust requirement.

## Application

Use one relevant implementation skill at a time, then a focused review if useful. The shared PRD, DESIGN and API contract remain the implementation reference. A skill's presence is not evidence of better UI or successful verification.
