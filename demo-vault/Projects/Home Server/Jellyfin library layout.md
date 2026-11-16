---
type: note
project: "[[Home Server]]"
tags:
  - homelab
  - jellyfin
  - media
---

# Jellyfin library layout

Jellyfin finds films and series by folder and file name, so the layout is the whole trick. Everything lives under `/srv/media` on the RAID, mounted read-only into the container ([[Docker Compose stack]]).

## Folder tree

```text
/srv/media
├── Films
│   ├── Spirited Away (2001)
│   │   ├── Spirited Away (2001).mkv
│   │   ├── Spirited Away (2001).ja.srt
│   │   └── Spirited Away (2001).en.srt
│   ├── Perfect Days (2023)
│   └── Volver (2006)
├── Series
│   └── Money Heist (2017)
│       ├── Season 01
│       │   ├── Money Heist S01E01.mkv
│       │   └── Money Heist S01E01.es.srt
│       └── Season 02
├── Learning
│   ├── Japanese
│   └── Spanish
├── Music
│   └── Amália Rodrigues
│       └── Amália (1957)
└── Home videos
    ├── 2024 Moving day
    └── 2025 Sofia's wedding
```

## Naming rules

- Films: `Title (Year)/Title (Year).ext`
- Series: `Show (Year)/Season 01/Show S01E01.ext`
- Subtitles next to the video, same name plus a language code: `.ja.srt`, `.es.srt`, `.en.srt`, `.pt.srt`
- No release-group junk in names; rename on the laptop before copying
- Year in brackets avoids mix-ups between remakes

## Libraries

| Library | Folder | Type | Who sees it |
|---|---|---|---|
| Films | `/media/Films` | Movies | everyone |
| Series | `/media/Series` | Shows | everyone |
| Learning | `/media/Learning` | Mixed | Noa, Rui |
| Music | `/media/Music` | Music | everyone |
| Home videos | `/media/Home videos` | Home videos and photos | Noa, Rui |

Users: **Noa**, **Rui**, and **Guest** (for [[Sofia]] when she visits, films and series only).

## Language practice

The Learning library and the subtitle files are the real reason this exists for me (see [[Languages]]):

- Japanese: Ghibli films with Japanese audio and **Japanese subtitles**, then English if I'm lost. Slowly getting faster at katakana this way.
- Spanish: series with Spanish audio and Spanish subtitles only. Good listening practice for the DELE.
- In the player: subtitle language per user, so Rui gets Portuguese and I get the target language.

## Direct play only

The Pi 5 has **no hardware video encoder**, so transcoding on the fly is painfully slow. Rule: every file must play directly on the TV.

- Video: H.264 or HEVC, up to 1080p
- Audio: AAC or AC3 stereo
- Container: MKV or MP4
- Anything else gets converted on the laptop with HandBrake first

In the Jellyfin dashboard, transcoding is limited to audio only, so a wrong file fails fast instead of making the Pi crawl.

## Home videos

- `2024 Moving day`: the van, the stairs, the first night on a mattress on the floor ([[Moving to Lisbon]])
- `2025 Sofia's wedding`: speeches and the first dance; my speech is in there too ([[Sofia's Wedding Speech]])
- Raw clips from the Fujifilm go into Nextcloud first, edited ones end up here

Back to [[Home Server]]
