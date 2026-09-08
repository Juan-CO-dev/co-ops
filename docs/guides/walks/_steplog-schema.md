# Step-log schema

Walkers emit exactly this, one block per screenshot, appended to `walks/<guide>.steplog.md`.

```
## Step NN — <slug>
- URL: <path after the host, e.g. /operations/receiving>
- Persona / viewport: <name, role> / <WxH>
- Action: <what you clicked or typed, one line>
- Saw: <what the screen showed after the action — headline text, buttons, any message, in the words on screen>
- Shot: img/<guide>/NN-<slug>.png
- Confused: <optional — anything you re-read, guessed at, or could not find>
- Bug?: <optional — error text, dead control, wrong data>
```

Rules:

- Number in walk order, two digits, contiguous. One shot per step. A goal with several screens is several steps.
- `Saw` quotes the screen. Button labels and headings go in their exact wording, because the writer will use them.
- Never skip a goal silently. Write `BLOCKED <goal>: <why>` as a step with no shot, then move on.
- Record every note or comment field you meet: where it was, and what its placeholder said.
