# Issue #117 — Players are booted out of their seat on new round start

Two-player room, driven against the real dev server (`yarn start`). The browser is
seated as **X**; the opponent (**O**) is driven over the API. After X wins, the
server auto-resets the round and `swapSeats` flips the browser player's mark from
**X** to **O** (the intended first-move-alternation feature).

## Before (bug)

- `before-01-seated-as-X.png` — seated baseline: "Leave seat" / "You (X)".
- `before-02-booted-needs-reselect.png` — after the round reset the seat bar shows
  "**Play as O**" and the panel reads "**Player O**": the player was booted from
  the seat they kept and has to re-select. Server state confirmed `seats.O = null`.

The seat-release effect listed `mySeat` in its dependency array and its cleanup
fired `leaveSeat`; when the round reset flipped `mySeat` from `X` to `O`, React
tore the effect down and the cleanup sent a stray `DELETE /seat`, ejecting the
player.

## After (fix)

- `after-01-seated-as-X.png` — same seated baseline.
- `after-02-retained-seat-as-O.png` — after the identical reset the seat bar still
  shows "**Leave seat**" and the panel reads "**You (O)**": the player keeps their
  seat across the round. Server state confirmed `seats.O = <browser player>`.

(The opponent is shown as "Player O"/"Waiting for opponent" only because the test
harness drives it over the API without a heartbeating browser, so its seat lapses
on the 30s TTL — unrelated to this fix.)
