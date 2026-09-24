# Test fixtures

## portrait.jpg

Official NASA portrait of astronaut Frank Rubio, resized to 1920 x 2400 (4.6 MP, 884 KB).

- Source: https://commons.wikimedia.org/wiki/File:Frank_Rubio_official_portrait.jpg
- Author: NASA
- Licence: **Public domain** (PD-USGov-NASA)

Chosen because it is a real studio portrait with a plain background, clear
hair edges and one unambiguous face — the three things the segmentation and
detection tests actually need. The performance test upscales it to 12 MP rather
than committing a 30 MB original; BiRefNet always runs at 1024x1024, so only
the resize stages scale with the input, and those are what the timing measures.
