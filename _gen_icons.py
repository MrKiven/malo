"""
Generate Malo RSS app icons and tray icons.

Design: Rounded-rect background with warm orange gradient,
        classic RSS signal icon (dot + arcs) with a subtle cat-paw motif.

Output:
  assets/icons/extension/  - Chrome extension icons (16, 48, 128)
  assets/icons/app/        - Electron desktop app icons (icns, 256, 512, 1024, tray)
"""

from PIL import Image, ImageDraw
import os, shutil

SIZE = 1024  # Master icon size
EXT_DIR = os.path.join("assets", "icons", "extension")
APP_DIR = os.path.join("assets", "icons", "app")


def lerp_color(c1, c2, t):
    """Linear interpolate between two RGB colors."""
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def draw_circle(draw, cx, cy, r, fill):
    """Draw a filled circle."""
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def create_master_icon():
    """Create the 1024x1024 master icon."""
    S = SIZE
    margin = int(S * 0.04)
    corner_radius = int(S * 0.22)

    # ── Step 1: Create orange gradient (RGB, full canvas) ──
    gradient = Image.new("RGB", (S, S), (0, 0, 0))
    g_draw = ImageDraw.Draw(gradient)

    top_color = (255, 82, 20)       # Vibrant red-orange
    bottom_color = (255, 145, 30)   # Warm golden orange

    for y in range(S):
        t = y / max(S - 1, 1)
        color = lerp_color(top_color, bottom_color, t)
        g_draw.line([(0, y), (S - 1, y)], fill=color)

    # ── Step 2: Create rounded-rect alpha mask ──
    mask = Image.new("L", (S, S), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        [margin, margin, S - margin - 1, S - margin - 1],
        radius=corner_radius,
        fill=255,
    )

    # ── Step 3: Combine → RGBA with rounded corners ──
    bg = gradient.convert("RGBA")
    bg.putalpha(mask)

    # Start with transparent canvas
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img = Image.alpha_composite(img, bg)

    # ── Step 4: Subtle top highlight (optional depth effect) ──
    highlight = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    h_draw = ImageDraw.Draw(highlight)
    highlight_h = int(S * 0.12)
    for y in range(margin, margin + highlight_h):
        t = (y - margin) / highlight_h
        alpha = int(40 * (1 - t))
        h_draw.line([(margin, y), (S - margin - 1, y)], fill=(255, 255, 255, alpha))

    # Mask highlight to the rounded rect shape
    h_mask = highlight.split()[3]  # get its own alpha
    # Combine with rounded rect mask: min of both
    import PIL.ImageChops as IC
    combined_mask = IC.darker(h_mask, mask)
    highlight.putalpha(combined_mask)
    img = Image.alpha_composite(img, highlight)

    draw = ImageDraw.Draw(img)

    # ── Step 5: RSS Signal Icon (white) ──
    icon_color = (255, 255, 255, 255)

    rss_left = int(S * 0.15)
    rss_bottom = int(S * 0.85)

    # RSS dot (bottom-left)
    dot_r = int(S * 0.065)
    dot_cx = rss_left + dot_r + int(S * 0.01)
    dot_cy = rss_bottom - dot_r - int(S * 0.01)
    draw_circle(draw, dot_cx, dot_cy, dot_r, icon_color)

    # RSS arcs
    arc_cx = rss_left + int(S * 0.01)
    arc_cy = rss_bottom - int(S * 0.01)
    arc_w = int(S * 0.058)

    for r_factor in [0.25, 0.42, 0.59]:
        r = int(S * r_factor)
        draw.arc(
            [arc_cx - r, arc_cy - r, arc_cx + r, arc_cy + r],
            start=-90, end=0, fill=icon_color, width=arc_w,
        )

    # ── Step 6: Cat paw accent (top-right) ──
    paw_color = (255, 255, 255, 170)
    paw_cx = int(S * 0.77)
    paw_cy = int(S * 0.25)

    # Main pad (oval)
    pad_rx = int(S * 0.062)
    pad_ry = int(S * 0.052)
    draw.ellipse(
        [paw_cx - pad_rx, paw_cy - pad_ry, paw_cx + pad_rx, paw_cy + pad_ry],
        fill=paw_color,
    )

    # Three toe beans
    toe_r = int(S * 0.026)
    toe_positions = [
        (paw_cx - int(S * 0.052), paw_cy - int(S * 0.068)),
        (paw_cx, paw_cy - int(S * 0.088)),
        (paw_cx + int(S * 0.052), paw_cy - int(S * 0.068)),
    ]
    for tx, ty in toe_positions:
        draw_circle(draw, tx, ty, toe_r, paw_color)

    return img


def create_tray_icon(size):
    """Create a macOS menu bar template image (black on transparent)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    icon_color = (0, 0, 0, 255)
    margin = max(1, int(size * 0.1))

    # RSS dot
    dot_r = max(1, int(size * 0.1))
    dot_cx = margin + dot_r
    dot_cy = size - margin - dot_r
    draw_circle(draw, dot_cx, dot_cy, dot_r, icon_color)

    # Arcs
    arc_cx = margin
    arc_cy = size - margin
    arc_w = max(1, int(size * 0.09))

    for r_factor in [0.32, 0.55, 0.78]:
        r = int(size * r_factor)
        draw.arc(
            [arc_cx - r, arc_cy - r, arc_cx + r, arc_cy + r],
            start=-90, end=0, fill=icon_color, width=arc_w,
        )

    return img


def create_iconset_and_icns(master):
    """Create .iconset folder and convert to .icns using macOS iconutil."""
    iconset_dir = os.path.join(APP_DIR, "icon.iconset")
    os.makedirs(iconset_dir, exist_ok=True)

    iconset_sizes = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]

    for name, px in iconset_sizes:
        resized = master.resize((px, px), Image.LANCZOS)
        resized.save(os.path.join(iconset_dir, name))
        print(f"    {name} ({px}x{px})")

    icns_path = os.path.join(APP_DIR, "icon.icns")
    ret = os.system(f"iconutil -c icns '{iconset_dir}' -o '{icns_path}'")
    if ret == 0:
        print(f"    ✓ icon.icns")
    else:
        print(f"    ✗ iconutil failed (code {ret})")

    shutil.rmtree(iconset_dir, ignore_errors=True)
    return icns_path


def main():
    os.makedirs(EXT_DIR, exist_ok=True)
    os.makedirs(APP_DIR, exist_ok=True)

    # 1. Generate master icon
    print("🎨 Generating master icon (1024x1024)...")
    master = create_master_icon()

    # Sanity check
    px = master.getpixel((512, 300))
    print(f"    Pixel at (512,300): RGBA={px}")
    assert px[0] > 200 and px[3] > 200, f"ERROR: Background not orange! Got {px}"
    print("    ✓ Orange gradient verified")

    # 2. Chrome extension icons
    print("\n📦 Chrome extension icons → assets/icons/extension/")
    for size in [16, 48, 128]:
        resized = master.resize((size, size), Image.LANCZOS)
        out = os.path.join(EXT_DIR, f"icon{size}.png")
        resized.save(out)
        print(f"    ✓ icon{size}.png ({size}x{size})")

    # 3. Electron app icons
    print("\n🖥️  Electron app icons → assets/icons/app/")
    for size in [256, 512, 1024]:
        resized = master.resize((size, size), Image.LANCZOS)
        out = os.path.join(APP_DIR, f"icon{size}.png")
        resized.save(out)
        print(f"    ✓ icon{size}.png ({size}x{size})")

    # 4. macOS .icns
    print("\n🍎 macOS .icns:")
    create_iconset_and_icns(master)

    # 5. Tray template images
    print("\n🔲 Tray template images → assets/icons/app/")
    for size, suffix in [(16, ""), (32, "@2x"), (44, "@3x")]:
        tray = create_tray_icon(size)
        name = f"trayTemplate{suffix}.png"
        tray.save(os.path.join(APP_DIR, name))
        print(f"    ✓ {name} ({size}x{size})")

    print("\n✅ All icons generated!")


if __name__ == "__main__":
    main()
