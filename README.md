# Six-Love

A tennis take on the 20-0 roster game. The draw lands on an era, you take one pro from it and give them a spot, then the season plays out.

- **College team**: six-player ladder, twelve duals to the NCAA final. The ladder must run in order of ability or a line is defaulted (the NCAA stacking rule).
- **Nation cup team**: two singles players and a doubles pair, seven ties, home ties on your surface.
- Tours: ATP, WTA, or mixed. Modes: Classic (ratings shown), Scout (names only), Daily (seeded, one shot).

Plain static files, no build. `python3 -m http.server 8300` to run locally. `node tools/sim.mjs` simulates thousands of seasons for balancing.
