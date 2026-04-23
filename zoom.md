Improved Infinite Zoom Architecture
(Hybrid Spatial + Generative + Narrative System)
0. Guiding Principle (what changes)

Your version treats each zoom level as a new image generation problem.

This version treats it as:

a continuous refinement of the same visual world

That single shift fixes most of the issues.

1. Core Data Model (this is the biggest upgrade)

Instead of a simple quadtree node, use a stateful generative node:

type ZoomNode = {
  id: string;

  // Spatial
  bounds: { x: number; y: number; size: number };
  level: number;

  // Rendering
  texture?: GPUTexture;
  status: "empty" | "loading" | "ready";

  // Generative state (CRITICAL)
  prompt: string;
  seed: number;

  // Style persistence
  style: {
    palette: number[];       // dominant colors
    embedding: number[];     // style vector (CLIP or similar)
    lighting: string;
  };

  // Visual continuity
  parentImageRegion?: ImageData; // cropped parent region

  // Narrative state
  context: {
    theme: string;
    objects: string[];
    depthHint: string;
  };

  children?: ZoomNode[];
};
Why this matters

You’re no longer generating random children—you’re evolving a consistent visual lineage.

2. Hybrid Structure (Quadtree + Narrative Graph)
Keep:
Quadtree → for rendering + LOD
Add:
Narrative Graph Layer
type NarrativeEdge = {
  fromNode: string;
  toNode: string;
  type: "zoom" | "focus" | "portal";
  semanticLabel: string; // e.g. "door", "window", "object"
};
Why this matters

You avoid the “4 meaningless quadrants” problem.

Now:

Some zooms follow spatial subdivision
Others follow semantic focus points

👉 Example:

Instead of splitting a classroom into 4 random tiles
You zoom specifically into:
desk
globe
window
3. Generation Pipeline (this is the core fix)
❌ Your version:

Prompt → Generate → Done

✅ Improved pipeline:
Step 1: Crop parent region
region = crop(parent.image, child.bounds);
Step 2: Extract features
features = {
  palette: extractColors(region),
  embedding: encodeImage(region),
  edges: detectEdges(region)
};
Step 3: Generate refined prompt
child.prompt = LLM({
  parentPrompt,
  regionDescription,
  narrativeContext,
  zoomIntent
});
Step 4: Image-to-image generation
child.image = generateImage({
  prompt: child.prompt,
  init_image: region,
  strength: 0.6,   // VERY IMPORTANT
  seed: parent.seed + hash(child.bounds),
  style: parent.style
});
Step 5: Post-process for continuity
color match to parent
edge blending at borders
Why this works
You preserve structure
You refine detail
You maintain style consistency

This is the difference between:

✗ “new image each time”
✓ “zooming into the same image”
4. Rendering Engine (practical setup)
Use:
PixiJS (recommended)
simpler than Three.js
perfect for 2D texture tiling
Scene graph:
Stage
 ├── Tile (node 0,0)
 ├── Tile (node 0,1)
 ├── Tile (node 1,0)
 └── Tile (node 1,1)
Camera:
camera = {
  x: number,
  y: number,
  scale: number
};
Tile selection logic
function getVisibleNodes(camera) {
  const level = Math.floor(Math.log2(camera.scale));

  return quadtree.getNodesInView({
    level,
    viewport: camera.bounds
  });
}
5. Predictive Prefetching (mandatory)
When user zooms into a node:

Immediately:

Generate:
its 4 children
1 likely “focus child” (based on cursor position)
priorityQueue = [
  cursorQuadrant,
  siblings,
  nextDepth(cursorQuadrant)
];
Placeholder strategy (critical)

Before generation completes:

show:
blurred crop of parent
slight sharpen over time

This hides latency almost completely.

6. Caching Strategy (replace LRU)
Use: Path-aware cache

Keep:

full path from root → current node
siblings of current node
one level deeper (prefetched)

Evict:

branches not touched recently AND far from path
score(node) =
  distanceFromCamera(node) +
  depthPenalty(node) -
  pathBonus(node);
7. Seamless Transition Strategy

Instead of simple crossfade:

Use layered blending:
render(parent);
render(child, alpha = smoothstep(zoomProgress));
Optional upgrade:
edge feathering mask
slight zoom blur during transition
8. Narrative Engine (your differentiator)

Each zoom isn’t just spatial—it’s intentional.

LLM Input:
{
  "parent_theme": "achievement",
  "current_object": "stairs",
  "zoom_target": "top right",
  "depth": 3
}
LLM Output:
{
  "prompt": "a glowing university entrance at the top of stone stairs",
  "objects": ["door", "light", "students"],
  "next_focus_candidates": ["door", "window"]
}
This enables:
guided exploration
recurring motifs
symbolic storytelling
9. Performance Targets (realistic)

To feel smooth:

generation latency: <1–2s per tile (hidden via placeholders)
render: 60 FPS
memory: ~100–300 textures active
10. What your final system becomes

Not just:

“infinite zoom”

But:

a continuous, self-consistent, AI-generated world that deepens as you explore it

Blunt comparison
Aspect	Your Version	Improved Version
Structure	Pure quadtree	Quadtree + semantic graph
Generation	Text-to-image	Image-conditioned refinement
Consistency	Weak	Strong
Latency handling	Basic	Hidden via placeholders + prefetch
Narrative	Linear	Stateful + evolving
If you want to go even further

You could push this into:

latent-space zooming (instead of pixel space)
or:
NeRF-style continuous scenes

But that’s a different level of complexity.

Final take

Your original idea is solid—but it’s missing:

visual continuity mechanics
state persistence
semantic control

This version fixes all three.