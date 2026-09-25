# Licensing — trial, keys, and how to issue them

This is how Philmer ID Photo Studio is sold: a 14-day trial that needs no key,
and a permanent key that works on one PC, forever, with no internet.

## What this can and cannot do

It **can** make keys impossible to forge or share:

- Keys are signed with a private key that only the vendor has. Nobody can
  write a keygen without it — not with the app in front of them, because the
  app only carries the public key.
- A key names one machine. Copied to another PC it simply does not work.

It **cannot** make the program impossible to crack. Anyone who can patch a
Windows binary can remove a check, and no amount of obfuscation changes that
for an offline app. The realistic bar is the one above: a customer cannot pass
their key to another shop, and nobody can mint keys. Cracking means
distributing a patched `.exe`, which is a different kind of person from a
printing counter that wants a second copy.

## The trial

- 14 days from first run, fully working. A shop has to be able to print and
  sell a real photo to believe the thing works.
- Locked to the machine, so uninstalling and reinstalling does not start it
  again. The record lives in two places — the registry under `HKCU` and a file
  in `%PROGRAMDATA%` — and the earliest date found wins.
- Each run stores the day it was last seen. If the clock is later found to
  have gone *backwards* by more than a day, the trial is over: that is the
  one-click attack, and it is worth closing.
- When the trial ends the app still opens, still loads and edits a photo, and
  still shows the sheet. Saving, exporting and printing are refused. The
  operator can see it works; they just cannot sell with it.

## The key

A key looks like this, and is pasted in (never typed):

```
PHILMER-1-K7Q2M8ZX4NB6...  (about 140 characters)
```

Inside is 22 bytes of payload plus a 64-byte Ed25519 signature:

| Field | Bytes | Meaning |
|---|---|---|
| version | 1 | format version, currently 1 |
| edition | 1 | 1 = standard |
| machine | 8 | the fingerprint of the PC it is for |
| expiry | 4 | day number, or 0 for a permanent key |
| issued | 4 | day number, for your records |
| customer | 4 | your own customer number |

The app checks the signature against its built-in public key, then checks the
machine matches. Both have to pass.

## The machine fingerprint

SHA-256 over the Windows `MachineGuid` and the system drive's volume serial,
truncated to 8 bytes. The app shows it as four groups, e.g. `A1B2-C3D4-E5F6-7890`.

It survives a hardware swap, new peripherals and Windows updates. It does
**not** survive reinstalling Windows or reformatting the system drive — when
that happens, issue a replacement key. That is a support cost, not a leak: you
keep the customer list, so you know whether it is the same customer.

## Issuing a key (the runbook)

Once, ever, on the vendor's machine:

```
cargo run --manifest-path tools/keygen/Cargo.toml -- init
```

This writes `philmer-signing-key.txt` **outside the repository**, and prints
the matching public key. The public key goes in
`crates/license-core/src/lib.rs` as `PUBLIC_KEY`; the private key never leaves
that machine, and never goes into git. Losing it means every future key has to
be reissued, so keep a copy somewhere safe and offline.

Then, per customer:

1. They install, open **Settings → Licence**, and read out their Machine ID.
2. You run:

   ```
   cargo run --manifest-path tools/keygen/Cargo.toml -- issue \
       --machine A1B2-C3D4-E5F6-7890 --customer 1042 --name "Lita's Photo, Bacolod"
   ```

   It prints the key and appends a line to `licenses-issued.csv`.
3. They paste the key into the same screen and press Activate.

For a replacement (new PC, reformatted drive), issue again against the new
Machine ID with the same customer number. The CSV then shows both, which is
how you spot a customer asking for their fifth "replacement".

To sell a time-limited licence instead of a permanent one, add `--days 365`.

## Where things are stored on the customer's PC

| What | Where |
|---|---|
| Licence key | `%PROGRAMDATA%\Philmer ID Photo Studio\license.key` |
| Trial record | `%PROGRAMDATA%\Philmer ID Photo Studio\trial.dat` and `HKCU\Software\Philmer Digi Art\Philmer ID Photo Studio` |

The trial record carries a keyed hash so that editing it by hand voids it.
That secret is inside the binary, so it stops a curious operator, not a
determined attacker — which is the honest limit of any offline trial.
