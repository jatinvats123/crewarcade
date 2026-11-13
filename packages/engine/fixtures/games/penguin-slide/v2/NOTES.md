- hotfix: hugging the right wall lets the penguin dodge every snowman (bug hunter: a playtester)
- Root cause: obstacles spawned inset by their own half-size, which could exceed the penguin's half-width,
  so a penguin flush against the edge sat outside every obstacle's reachable spawn positions.
- Fix: obstacles spawn across the full width and the penguin's slide range stops `WALL_PAD` short of the edge.
- Verified with the saved repro (`v1/repro-1.json`): holding ArrowRight for 30 s now ends the run.
- Nothing else changed: scoring, speed ramp, fish pickups and scene transitions are untouched.
