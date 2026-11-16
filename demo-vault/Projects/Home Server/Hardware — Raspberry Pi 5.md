---
type: note
project: "[[Home Server]]"
tags:
  - homelab
  - hardware
---

# Hardware — Raspberry Pi 5

## Parts

| Part | Model / spec | Price | Notes |
|---|---|---|---|
| Board | **Raspberry Pi 5, 8 GB** | €88 | 4 GB would have been tight with Nextcloud and Jellyfin |
| Boot drive | 512 GB NVMe SSD on the M.2 HAT+ | €52 | **NVMe boot**, no SD card in normal use |
| Cooling | official Active Cooler | €6 | fan rarely spins above 30% |
| Power supply | official 27 W USB-C | €13 | the drives have their own supply |
| Data drives | 2 × **4 TB** 3.5" NAS drives | €2 × 109 | **RAID 1** with mdadm, see [[RAID 1 with mdadm]] |
| Enclosure | dual-bay USB 3 enclosure, set to JBOD | €69 | hardware RAID switched **off**, mdadm does it |
| UPS | 650 VA line-interactive | €95 | bought after the [[Power outage 2026-08-04]] |
| Case | 3D-printed case from a friend | €0 | fits the HAT+ and the cooler |
| **Total** | | **€541** | |

## Why a Pi and not a mini PC

- **Power:** the Pi idles at about **7 W**, measured at the wall with a smart plug, drives spun down. A second-hand mini PC idled at 14–18 W. At Lisbon electricity prices that difference pays for the Pi in about two years.
- **Silence:** it lives on the bookshelf in the living room. The fan is inaudible; the drives make a small click when they wake up.
- **It's enough.** Five containers, two users, a few devices.

Trade-off I accepted: no hardware video encoding, so Jellyfin only plays files the TV can decode directly. See [[Jellyfin library layout]].

## Boot from NVMe

Flashed Raspberry Pi OS Lite (64-bit) onto the NVMe with the imager, then set the boot order once from an SD card:

```bash
sudo rpi-eeprom-config --edit
# BOOT_ORDER=0xf416   -> NVMe first, then SD, then USB
# PCIE_PROBE=1
sudo reboot
```

Boot time from power-on to all containers healthy: about 70 seconds.

## Temperatures

| State | CPU temp |
|---|---|
| Idle | 41 °C |
| Nextcloud photo scan | 63 °C |
| August heat wave, room at 31 °C | 68 °C, no throttling |

## Things I'd do differently

- Buy the 4 TB drives from two different batches, so they don't fail in the same month
- Get the UPS on day one, not after an outage
- Write the drive serial numbers on the front of the enclosure (now done, with a label maker)

Back to [[Home Server]]
