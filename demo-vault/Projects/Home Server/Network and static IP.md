---
type: note
project: "[[Home Server]]"
tags:
  - homelab
  - network
---

# Network and static IP

## The flat's network

- **1 Gbps fibre**, €38/month (see [[Home]])
- The provider's router sits in the hallway by the front door, at `192.168.1.1`
- The Pi is on a cable, run along the skirting board to the bookshelf in the living room. Wi-Fi on the Pi is switched off.

## Address plan

| Range / address | Use |
|---|---|
| `192.168.1.1` | router |
| `192.168.1.2 – .99` | fixed addresses, set by hand |
| **`192.168.1.20`** | **the Pi, static** |
| `192.168.1.21` | kept free for a second Pi-hole |
| `192.168.1.30` | printer |
| `192.168.1.100 – .199` | DHCP pool for phones, laptops, TV, everything else |

The Pi's address is set on the Pi itself and sits outside the DHCP pool, so the router can never hand it to anything else.

## Setting the static address

Raspberry Pi OS (Bookworm) uses NetworkManager:

```bash
nmcli con show
sudo nmcli con mod "Wired connection 1" \
  ipv4.method manual \
  ipv4.addresses 192.168.1.20/24 \
  ipv4.gateway 192.168.1.1 \
  ipv4.dns "127.0.0.1 9.9.9.9"
sudo nmcli con up "Wired connection 1"
ip -4 addr show eth0
```

The Pi asks its own Pi-hole first (`127.0.0.1`) and Quad9 as a fallback, so it can still pull images and updates if the Pi-hole container is down.

## Router settings

- DHCP: pool `.100–.199`, lease 24 h
- DNS handed out by DHCP: **`192.168.1.20` only** (why: [[Pi-hole notes]])
- **No port forwarding.** Nothing on the server is reachable from the internet
- UPnP switched off
- Wi-Fi: one network for us, a guest network for visitors, isolated from the LAN

## From outside the flat

A private VPN (Tailscale) on the Pi, our phones and laptops. From the café or from Porto we open Jellyfin or Nextcloud by the Pi's VPN name, and nothing is open on the router. It will matter in Japan, when I want to show [[Kenji Mori]] our terrace photos without carrying them on the phone (see [[Japan Trip 2027]]).

## Checks

```bash
ping -c 3 192.168.1.1        # router reachable
dig @192.168.1.20 example.com # Pi-hole answers
ss -tulpn | grep ':53'        # who listens on DNS
```

## Things to remember

- If the provider ever replaces the router, the DHCP DNS setting goes back to default and Pi-hole silently stops seeing traffic. Check the dashboard query count the day after.
- Write the router admin password on the label under the router? No. It's in the password manager, under "Router".

Back to [[Home Server]]
