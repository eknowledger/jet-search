---
type: note
project: "[[Home Server]]"
tags:
  - homelab
  - dns
  - pihole
---

# Pi-hole notes

Pi-hole answers DNS for every device in the flat and quietly drops requests to ad and tracking domains. It runs in Docker on the Pi ([[Docker Compose stack]]) and listens on `192.168.1.20:53`.

## How much it blocks

Pi-hole blocks about **18% of DNS queries** on a normal day. Snapshot from the dashboard, Sunday 2026-10-25:

| | |
|---|---|
| Queries, last 24 h | 21,340 |
| Blocked | 3,870 (18.1%) |
| Devices seen | 14 |
| Domains on the blocklists | ~410,000 |

Who is the noisiest? The smart TV, by far. It tries to phone home every few seconds while it's on, even when we are watching something from Jellyfin. Second place: free games on phones.

## Setup that matters

- The router hands out **only** `192.168.1.20` as DNS. No second DNS server: if there's one, most devices use it half the time and skip Pi-hole. (Downside: when the Pi is down, the flat has no DNS. See [[Power outage 2026-08-04]].)
- Upstream DNS: Quad9 (`9.9.9.9`, `149.112.112.112`)
- Conditional forwarding to the router, so the query log shows names, not just IPs
- Blocklists: StevenBlack's unified hosts list and the OISD "big" list, refreshed every Sunday

Details of the router side in [[Network and static IP]].

## Allowlist (things that broke)

| Domain pattern | Why it's allowed |
|---|---|
| a bank's login helper domain | the banking app froze on the login screen |
| the TV's app store | apps wouldn't update |
| a recipe site's image server | the photos in recipes were missing ([[Cooking]]) |
| a parcel tracker's link domain | tracking links from the Nordhaus delivery wouldn't open |

Rule: allow the **exact** domain, never a whole wildcard, and write down why.

## Commands

```bash
docker exec -it pihole pihole status          # is blocking on?
docker exec -it pihole pihole -g              # update the blocklists now
docker exec -it pihole pihole allow cdn.example.org
docker exec -it pihole pihole deny ads.example.net
docker exec -it pihole pihole -t              # live query log
```

To pause blocking for five minutes (when a site refuses to load and Rui is waiting): dashboard → Disable blocking → 5 minutes.

## Rui's view

> "It's great until it isn't, and then it's your fault."

Fair. That's why there's a 5-minute disable button on his phone's home screen now.

## Ideas

- A second Pi-hole on a spare Pi Zero, so DNS survives a reboot of the main server (on [[Ideas for the server]])
- Separate group for guests with lighter blocking

Back to [[Home Server]]
