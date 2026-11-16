---
type: note
area: "[[Home]]"
tags: [home, tech]
---
# Internet and Wi-Fi

**1 Gbps fibre, €38/month.** Installed on 2024-06-19, four days after we moved in ([[First week in Lisbon]]). The 24-month loyalty period ended in June 2026, so the contract can be renegotiated or switched any time now.

## The setup

- The fibre comes into the hallway: the operator's box (ONT) → the operator's router → two TP-Link Deco X50 units in mesh (living room and the small bedroom).
- The thick 1930s walls kill Wi-Fi. Wired: ~940 Mbps. Living room Wi-Fi: ~600 Mbps. Bedroom: ~350 Mbps. Terrace: patchy.
- DNS for the whole house goes to Pi-hole on the [[Home Server]] at 192.168.1.20, which blocks about 18% of queries.
- DHCP reservation for the Pi so the address never changes.

## Networks

| Name | For | Notes |
|---|---|---|
| Pimenta | us | WPA3/WPA2 mixed, 2.4 + 5 GHz on one name |
| Pimenta-Guest | visitors | isolated from the house devices; QR code on the fridge — [[Make a Wi-Fi QR code]] |
| Pimenta-IoT | plugs, sensors, the TV | 2.4 GHz only; Home Assistant talks to it |

Passwords are in the password manager, not here.

## When it breaks

1. Is it everything or one device? Try the phone on mobile data.
2. Pi down? If Uptime Kuma sent an alert, it's DNS — the Pi, not the fibre. Restart the Pi-hole container.
3. Restart in order: ONT (wait for the green light) → router → main Deco → second Deco.
4. Red light on the ONT = their problem. Call the support line and ask for the fibre signal to be checked.

There is deliberately **no secondary DNS** — a fallback would let traffic skip Pi-hole. If the Pi is down, I know about it fast.

## Speed tests

| Date | Wired | Living room | Bedroom |
|---|---:|---:|---:|
| 2024-06-19 | 935 | 410 (old router only) | 90 |
| 2024-07-10 | 941 | 620 | 340 |
| 2026-09-30 | 938 | 590 | 355 |

## To do

- [ ] Ring up in November and ask for a better price now the loyalty period is over — competitors are €30 for the same speed
- [ ] Third Deco for the terrace before summer? Or a cheap outdoor access point
- [ ] Move the TV to the IoT network (it phones home a lot — Pi-hole shows it)
