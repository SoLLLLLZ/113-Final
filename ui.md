This is really clear now. Let me define the full UI spec based on your references.

Overall Visual Language
Dark space background — near black with very subtle deep navy undertone, like #03030d. The shards float in this void, not sitting on a surface. No grid, no floor, no UI chrome except minimal controls. The whole experience feels like floating through space looking at broken glass held together by light.

Shard Design — The Core Element
Based on image 5 (the game screenshot) — this is exactly the right reference.
Each shard is a convex irregular polygon — 5 to 7 sides, sharp angular cuts, no smooth curves anywhere. Think broken tempered glass, not ceramic. The edges are clean and hard.
The glass material is the most important part:
Surface:    The AI-generated image fills the shard interior
            Image has slight desaturation — 85% saturation so 
            the glass effect reads over it

Edge bevel: 4-6px bright rim along every edge — this is what 
            makes it look like glass. The bevel catches light
            and appears as a thin bright line

Reflection: A subtle diagonal highlight — a soft white gradient
            running from top-left corner fading to transparent
            by the center. Like light hitting glass at an angle.
            Opacity around 15-20%.

Refraction: Very slight distortion at the edges where the image
            meets the border. Creates the illusion of thickness.

Depth:      Each shard has a 3-4px dark shadow on its bottom-right
            edge, opposite the highlight bevel. Makes it feel like
            it has physical thickness and is floating.

Tilt:       Each shard has a slight random 3D perspective tilt —
            maybe 3-8 degrees — so they look like they're 
            tumbling slowly in space, not lying flat.
Text on the shard:
Response text:  White, semi-bold, 13px, centered in the lower 
                third of the shard. Slight text shadow for 
                legibility over the image.
                
Category tag:   Gold, 9px, uppercase, spaced letters, sits 
                above the response text. "REGRET" / "PROUD" / 
                "UNFINISHED"
                
Both text elements have a very subtle dark gradient behind 
them — not a solid block, just a soft darkening of the 
image in the lower third.

2D Mosaic View
The shards are scattered across a large infinite canvas — not in a grid, not in a circle. Organic clustering like a real shattered object, denser in the center, looser at the edges. Gaps between shards range from 12px to 30px — wide enough to see the gold seams clearly but tight enough to feel like one broken whole.
Navigation:
Mouse drag         → pan through the canvas
Scroll wheel       → zoom in/out (smooth, not stepped)
Pinch              → zoom on mobile
Double-click shard → focus zoom into that shard
Scroll past 3x     → LOD 2 generates for focused shard
Shard hover state:
Bevel brightens    → edge highlight intensifies
Scale: 1.04        → very slight lift
Z-index rises      → comes forward in the stack
Cursor: pointer
Response text fades up if not already visible
Seam hover state:
Gold line brightens and thickens
Particle dots pulse along the seam
Seam label appears in a small dark pill above the midpoint

3D Pottery View
Triggered by the Combine button. The pottery floats in the same dark void as the 2D mosaic — consistent environment.
The pottery itself:
Material:     Dark ceramic base — near black with subtle 
              texture. NOT glossy ceramic, more like 
              unglazed raku pottery. Dark and earthy.
              
Shards:       Same glass shard design mapped onto the 
              surface. The bevel, the reflection highlight, 
              the depth — all preserved on the curved surface.
              
Gold seams:   Thick raised TubeGeometry sitting proud of 
              the surface. Metalness 0.95, roughness 0.08.
              They glow subtly — emissiveIntensity 0.3.
              Where seams intersect, a small gold node dot.
              
Placeholder:  Undecorated dark ceramic — same base material
              as the pot body, slightly lighter. No image.
              Looks like the pot was never filled there.
Navigation:
Left drag      → orbit around the pottery
Right drag     → pan the camera
Scroll         → dolly zoom in/out
Double-click   → focus on that shard, begin zoom
Zoom past 2x   → enters the shard's infinite zoom hierarchy
Lighting rig:
Key light:     Warm point light, top-right, color #fff5e0
               Creates the glass bevel sparkle

Fill light:    Cool soft light, left, color #c8d8ff  
               Gives depth to the shadow side

Rim light:     Thin bright light from directly behind
               Makes the gold seams glow at the edges

Ground bounce: Very subtle warm uplight from below
               Color #3a2800, low intensity
               Makes it feel grounded even floating in space

The Transition Animation
When Combine is pressed:
0.0s  Combine button pulses gold

0.2s  Seams on the 2D canvas begin glowing brighter,
      pulsing with light traveling along them toward center

0.6s  Shards begin lifting — Z position rises, slight 
      rotation begins. They start spinning slowly like 
      debris in zero gravity.

0.8s  Camera pulls back to show all shards at once

1.2s  Shards begin converging toward center.
      Long-range shards travel first, nearby ones last.
      Each shard follows a curved arc path, not a 
      straight line — they swoop in like birds landing.

1.8s  Pottery shape materializes as a faint dark wireframe
      in the center

2.0s  Shards arrive at their positions on the pottery.
      Each one lands with a small impact flash — 
      a brief bright edge glow on arrival.

2.4s  Gold seams grow outward from each crack simultaneously,
      spreading like liquid gold filling a fracture.
      
2.8s  Pottery completes. Slow auto-rotate begins.
      Camera settles into orbit position.

3.2s  Ambient glow pulses once — the whole piece breathes.

Controls UI
Minimal. Bottom center of screen. Semi-transparent dark pills.
2D view:
[ ⟲ Mosaic ]  [ ◈ Combine ]  [ + ]  [ - ]

3D view:
[ ⟲ Mosaic ]  [ ↺ New Form ] [ + ]  [ - ]
The 3D View toggle from your reference image (top right) is clean — keep that pattern. Toggle between Mosaic and Pottery with a single switch.
Small zoom hint arrows like your reference image 3 — but only visible for 3 seconds on first load, then fade out permanently.

Zoom UI
No visible zoom bar. Zoom is purely scroll/pinch driven. When you zoom into a shard deep enough to trigger LOD generation, show a very subtle gold pulse ring emanating from the shard center — tells the user something is loading without a spinner. When the new image loads, it crossfades in over 300ms.

Color System
Background:         #03030d
Shard bevel light:  #ffffff at 70% opacity
Shard shadow edge:  #000000 at 60% opacity
Reflection gloss:   #ffffff at 15% opacity diagonal gradient
Gold seam primary:  #d4af37
Gold seam glow:     #fff0a0 at 20% opacity
Gold seam highlight:#fffde0 at 60% opacity
Text primary:       #ffffff
Text category:      #d4af37
Placeholder shard:  #1a1410

What Makes It Feel Like The Reference Image
The game screenshot (image 5) works because:

Shards overlap slightly — they're not all in one plane
Each shard tilts at a slightly different angle in 3D space
The edge bevel is very bright and sharp — it's the defining feature
Dark background makes the glass read instantly
The images inside are vivid and saturated against the dark surround

Match all five of those and you'll nail the aesthetic.