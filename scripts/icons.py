"""Render the simple code-defined MRT-Player mark. No downloaded artwork."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
assets = root / 'assets'
assets.mkdir(exist_ok=True)
font_file = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
if not Path(font_file).exists():
    font_file = '/System/Library/Fonts/Helvetica.ttc'

def icon(size: int) -> Image.Image:
    scale = 4
    length = size * scale
    image = Image.new('RGBA', (length, length), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    radius = int(length * .235)
    draw.rounded_rectangle((0, 0, length - 1, length - 1), radius=radius, fill='#84e5c5')
    # A slight light stroke keeps the symbol legible at TV icon dimensions.
    font = ImageFont.truetype(font_file, int(length * .64))
    box = draw.textbbox((0, 0), 'M', font=font)
    x = (length - (box[2] - box[0])) / 2 - box[0]
    y = (length - (box[3] - box[1])) / 2 - box[1] - length * .012
    draw.text((int(x), int(y)), 'M', font=font, fill='#12382e')
    return image.resize((size, size), Image.Resampling.LANCZOS)

if root.name == 'macOs':
    iconset = assets / 'MRT-Player.iconset'
    iconset.mkdir(exist_ok=True)
    for n in [16, 32, 64, 128, 256, 512, 1024]:
        icon(n).save(assets / f'logo-{n}.png')
    for pt in [16, 32, 128, 256, 512]:
        icon(pt).save(iconset / f'icon_{pt}x{pt}.png')
        icon(pt * 2).save(iconset / f'icon_{pt}x{pt}@2x.png')
    subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(assets / 'MRT-Player.icns')], check=True)
else:
    icon(80).save(assets / 'icon.png')
    icon(130).save(assets / 'largeIcon.png')
