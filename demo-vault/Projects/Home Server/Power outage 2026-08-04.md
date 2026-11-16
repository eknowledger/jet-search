---
type: log
project: "[[Home Server]]"
date: 2026-08-04
tags:
  - homelab
  - incident
---

# Power outage 2026-08-04

**What:** power cut across half of Alfama on Tuesday 4 August, in the middle of a heat wave
**How long:** 15:12 – 17:46, about 2 h 34 min
**Result:** the server went down hard; everything came back, but slowly and not cleanly
**Fix:** a UPS, bought three days later

## Timeline

| Time | What happened |
|---|---|
| 15:12 | Power off. Fridge silent, fan stops, the Pi dies mid-write |
| 15:30 | Neighbours on the stairs: whole street is out, the grid is overloaded with air conditioning |
| 17:46 | Power back. Router up in about 2 minutes |
| 17:48 | Pi tries to boot, hangs: the USB enclosure came up after the Pi and `/srv` wasn't there |
| 17:55 | Rui: "The internet is broken." It wasn't. Pi-hole was down, so nothing in the flat had DNS |
| 18:10 | Pulled the plug on the Pi, plugged it back in. Boots, `/srv` mounts |
| 18:15 | RAID resync starts, ~7 hours to go ([[RAID 1 with mdadm]]) |
| 18:30 | Nextcloud: "Internal Server Error" until the database finished its crash recovery |
| 19:00 | Home Assistant: history database corrupt, renamed and started fresh; lost two months of terrace temperature graphs |
| 01:20 | Resync done, `[UU]` |

## What broke and why

1. **Hard power loss mid-write.** No data lost in the end, but only by luck.
2. **Boot order.** The Pi booted faster than the enclosure. Fixed with `nofail` in `/etc/fstab` and a systemd dependency so Docker waits for `/srv`.
3. **DNS single point of failure.** With the router handing out only the Pi as DNS, a dead Pi means "no internet" for everyone. Accepted for now; second Pi-hole is on [[Ideas for the server]].
4. **No warning.** I found out from Rui, not from monitoring, because Uptime Kuma runs on the same box.

## The UPS

Bought 2026-08-07: a **650 VA line-interactive UPS**, €95. The Pi, the drive enclosure and the router are on it.

- Runtime test on 2026-08-09, plug pulled on purpose: **38 minutes** with all three on it
- Network UPS Tools (NUT) on the Pi reads the UPS over USB and shuts the Pi down cleanly at 20% battery

```ini
# /etc/nut/upsmon.conf (excerpt)
MONITOR ups@localhost 1 upsmon ${NUT_PASSWORD} primary
SHUTDOWNCMD "/sbin/shutdown -h +0"
FINALDELAY 5
```

```bash
upsc ups@localhost battery.charge   # 100
upsc ups@localhost ups.load         # 14  (%)
```

The router being on the UPS means the phones keep Wi-Fi and DNS during short cuts, which Rui says is the only feature that matters.

## Follow-ups

- [x] UPS bought and tested
- [x] `nofail` in fstab, Docker waits for `/srv`
- [x] Home Assistant recorder moved to a fresh database, nightly backup includes it ([[Backups with restic]])
- [ ] External check from outside the flat, so I hear about outages even when the Pi is the thing that's down
- [ ] Replace the UPS battery in ~2029 (date on a label on the back)

Back to [[Home Server]] · [[Hardware — Raspberry Pi 5]]
