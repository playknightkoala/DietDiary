# AGENTS.md

This file provides guidance to Codex (and other agents) when working with code in this repository.

## Single source of truth

**The canonical project guide is [`CLAUDE.md`](CLAUDE.md) — read it in full and follow it.**

Do not duplicate project documentation here: this file was previously a hand-maintained mirror of `CLAUDE.md` and drifted out of date (missing the optimistic-locking contract, the fail-closed photo-auth behavior, and newer regression scripts), which is exactly the kind of stale-architecture risk the guardrails try to prevent. Any project knowledge worth writing down goes into `CLAUDE.md`; this file only carries agent-discovery pointers.

## Skills

Canonical skills live under `.claude/skills/` (single source of truth):

- `.claude/skills/release/SKILL.md` — release flow (bump → changelog → build → commit → push → GitHub Release).
- `.claude/skills/design-guardrails/SKILL.md` — **load before designing/implementing any new feature, backend write path, or frontend editing flow**, and use as the rubric when self-reviewing changes.

The copies under `.agents/skills/` are tracked pointer files so Codex can discover them — never edit those; edit the canonical files only.
