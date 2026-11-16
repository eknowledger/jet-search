---
type: how-to
tags: [how-to, tech, home]
---
# Make a Wi-Fi QR code

So guests can join the guest network by pointing their camera at the fridge instead of me spelling out a long password. The guest network is isolated from the house devices — see [[Internet and Wi-Fi]].

## The text inside the code

A Wi-Fi QR code is just a short line of text in a fixed format:

```text
WIFI:T:WPA;S:Pimenta-Guest;P:the-password-here;;
```

- `T:` — security type: `WPA` (covers WPA2/WPA3), `WEP` or `nopass`
- `S:` — the network name (SSID)
- `P:` — the password
- `H:true;` — add this only if the network is hidden
- It ends with **two** semicolons

If the name or password contains `\ ; , " :` put a backslash in front of each one, e.g. `P:sardinhas\;assadas;`.

## Making it on the Pi

`qrencode` is in the package list on the [[Home Server]]:

```bash
sudo apt install qrencode
qrencode -o guest-wifi.png -s 10 -m 2 'WIFI:T:WPA;S:Pimenta-Guest;P:the-password-here;;'
```

- `-o` the output file
- `-s 10` makes each square 10 pixels — sharp when printed
- `-m 2` a small white border (phones need some margin)

To check it in the terminal before printing:

```bash
qrencode -t ansiutf8 'WIFI:T:WPA;S:Pimenta-Guest;P:the-password-here;;'
```

Single quotes around the text, so the shell leaves the semicolons alone.

## Without a computer

- Android (10 and newer): Settings → Wi-Fi → tap the network → Share. It shows the code on screen.
- iPhone: no built-in maker; any QR app that has a "Wi-Fi" option does the same thing.

## Testing

1. Phone off the network ("forget" it).
2. Open the camera, point at the code. iPhones and Androids both offer "Join network".
3. Check it actually connects, and that it lands on the **guest** network.

## Printing

- At least **4 cm** across. Matt paper — glossy reflects the kitchen light.
- Under it, in small letters: the network name, in case a phone can't scan.
- Stuck on the fridge with the Pimenta magnet. A second copy in the drawer for when Sofia stays over.

## When the password changes

Generate the code again and reprint. I change the guest password every January.
